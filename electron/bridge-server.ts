/**
 * Vault Bridge — minimal loopback HTTP API for Obsidian / Notion / scripts.
 * Vault owns notes + grounded Ask; external tools call this API (not the reverse).
 *
 * Security (v1): loopback-only, bearer-token auth, Host allowlist, JSON-only,
 * size-capped bodies, and no CORS. The per-install token is generated on first
 * use and stored at <userData>/lkv-bridge-token (0600).
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { askGrounded } from './generate'
import { getPrompt, listItems } from './db'
import { listMediaProjects } from './media-ingest'
import { resolveUserDataDir } from './user-data'
import { encryptSecret, decryptSecret } from './secret-store'
import type { BridgeAskResult, Citation } from './types'

export const BRIDGE_HOST = '127.0.0.1'
export const BRIDGE_PORT = 8765
export const BRIDGE_VERSION = '0.1.0'

const BRIDGE_TOKEN_FILE = 'lkv-bridge-token'
const MAX_BODY_BYTES = 64 * 1024

let server: http.Server | null = null

/* ---------------- token (per-install bearer credential) ---------------- */

function bridgeTokenPath(): string {
  return path.join(resolveUserDataDir(), BRIDGE_TOKEN_FILE)
}

function randomToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

function readTokenFile(p: string): string | null {
  try {
    if (!fs.existsSync(p)) return null
    return decryptSecret(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function writeTokenFile(p: string, token: string): void {
  const dir = resolveUserDataDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(p, encryptSecret(token), { encoding: 'utf8', mode: 0o600 })
  try {
    fs.chmodSync(p, 0o600)
  } catch {
    /* Windows may ignore mode */
  }
}

let cachedToken: string | null = null

/** Read the stored token, generating + persisting (0600) one on first use. */
export function getBridgeToken(): string {
  if (cachedToken) return cachedToken
  const p = bridgeTokenPath()
  const existing = readTokenFile(p)
  if (existing) {
    cachedToken = existing
    return existing
  }
  const token = randomToken()
  writeTokenFile(p, token)
  cachedToken = token
  return token
}

/** Regenerate the token (Settings "Regenerate"). */
export function rotateBridgeToken(): string {
  const token = randomToken()
  writeTokenFile(bridgeTokenPath(), token)
  cachedToken = token
  return token
}

/* ---------------- request hardening ---------------- */

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function authorized(req: http.IncomingMessage): boolean {
  const expected = getBridgeToken()
  const header = (req.headers.authorization ?? '').trim()
  const m = /^Bearer\s+(.+)$/i.exec(header)
  if (!m) return false
  const a = Buffer.from(m[1])
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function isAllowedHost(hostHeader: string, port: number): boolean {
  const h = hostHeader.trim().toLowerCase()
  const p = String(port)
  return (
    h === '127.0.0.1' ||
    h === `127.0.0.1:${p}` ||
    h === 'localhost' ||
    h === `localhost:${p}` ||
    h === '::1' ||
    h === '[::1]' ||
    h === `[::1]:${p}`
  )
}

function isJsonContentType(req: http.IncomingMessage): boolean {
  const ct = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  return ct === 'application/json'
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(data)
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (c) => {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c)
      total += buf.length
      if (total > MAX_BODY_BYTES) {
        req.removeAllListeners('data')
        reject(new HttpError(413, 'Request body too large'))
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function handleAsk(bodyRaw: string): Promise<BridgeAskResult> {
  let parsed: { text?: string; project?: string; promptId?: string }
  try {
    parsed = JSON.parse(bodyRaw || '{}') as typeof parsed
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }
  const text = (parsed.text ?? '').trim()
  if (!text) throw new HttpError(400, 'text is required')

  let systemExtra: string | undefined
  const promptId = (parsed.promptId ?? '').trim()
  if (promptId) {
    const p = getPrompt(promptId)
    if (p?.body?.trim()) systemExtra = p.body.trim()
  }

  const project = (parsed.project ?? '').trim()
  const result = await askGrounded({
    question: text,
    filters: project ? { project } : undefined,
    systemExtra,
  })

  const citations: Citation[] = result.citations ?? []
  return { answer: result.answer, citations }
}

function listProjectsSummary(): Array<{ project: string; noteCount: number; source?: string }> {
  try {
    const media = listMediaProjects()
    if (media.length > 0) {
      return media.map((p) => ({
        project: p.project,
        noteCount: p.noteCount,
        source: 'media',
      }))
    }
  } catch {
    /* fall through */
  }
  // Fallback: distinct project values from vault items
  const items = listItems()
  const counts = new Map<string, number>()
  for (const it of items) {
    const proj = (it.project ?? '').trim()
    if (!proj) continue
    counts.set(proj, (counts.get(proj) ?? 0) + 1)
  }
  return [...counts.entries()].map(([project, noteCount]) => ({
    project,
    noteCount,
    source: 'vault',
  }))
}

async function onRequest(req: http.IncomingMessage, res: http.ServerResponse, port: number): Promise<void> {
  // 1. DNS-rebinding guard: only loopback Hosts are served.
  if (!isAllowedHost(req.headers.host ?? '', port)) {
    json(res, 403, { error: 'Forbidden: invalid Host' })
    return
  }

  const method = (req.method ?? 'GET').toUpperCase()
  const url = new URL(req.url ?? '/', `http://${BRIDGE_HOST}:${port}`)
  const pathname = url.pathname.replace(/\/$/, '') || '/'

  if (method === 'OPTIONS') {
    // No CORS is granted, so no preflight is ever approved.
    json(res, 204, {})
    return
  }

  // Open liveness endpoints (no auth).
  if (method === 'GET' && (pathname === '/health' || pathname === '/')) {
    json(res, 200, {
      ok: true,
      name: 'Vault Bridge',
      version: BRIDGE_VERSION,
      host: BRIDGE_HOST,
      port,
    })
    return
  }

  // Everything below reads or writes vault data and requires the bearer token.
  if (!authorized(req)) {
    json(res, 401, { error: 'Unauthorized' })
    return
  }

  try {
    if (method === 'GET' && pathname === '/v1/projects') {
      json(res, 200, { projects: listProjectsSummary() })
      return
    }

    if (method === 'POST' && pathname === '/v1/ask') {
      if (!isJsonContentType(req)) {
        json(res, 415, { error: 'Unsupported Media Type: expected application/json' })
        return
      }
      const body = await readBody(req)
      const result = await handleAsk(body)
      json(res, 200, result)
      return
    }

    json(res, 404, { error: 'Not found', path: pathname })
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 400
    const msg = err instanceof Error ? err.message : String(err)
    json(res, status, { error: msg })
  }
}

/** Start the loopback-only Bridge HTTP server (idempotent). */
export function startBridgeServer(port: number = BRIDGE_PORT): http.Server {
  if (server) return server

  server = http.createServer((req, res) => {
    void onRequest(req, res, port)
  })

  server.listen(port, BRIDGE_HOST, () => {
    console.log(`[Vault Bridge] listening on http://${BRIDGE_HOST}:${port}`)
  })

  server.on('error', (err) => {
    console.error('[Vault Bridge] server error:', err)
  })

  return server
}

export function stopBridgeServer(): void {
  if (!server) return
  try {
    server.close()
  } catch {
    /* ignore */
  }
  server = null
}

export function getBridgeServerStatus(): {
  running: boolean
  host: string
  port: number
  version: string
} {
  return {
    running: !!server && server.listening,
    host: BRIDGE_HOST,
    port: BRIDGE_PORT,
    version: BRIDGE_VERSION,
  }
}
