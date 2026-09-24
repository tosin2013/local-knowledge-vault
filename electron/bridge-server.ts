/**
 * Vault Bridge — minimal loopback HTTP API for Obsidian / Notion / scripts.
 * Vault owns notes + grounded Ask; external tools call this API (not the reverse).
 *
 * Security (v0): binds 127.0.0.1 only; no auth yet. Do not expose beyond localhost.
 */
import http from 'http'
import { askGrounded } from './generate'
import { getPrompt, listItems } from './db'
import { listMediaProjects } from './media-ingest'
import type { BridgeAskResult, Citation } from './types'

export const BRIDGE_HOST = '127.0.0.1'
export const BRIDGE_PORT = 8765
export const BRIDGE_VERSION = '0.1.0'

let server: http.Server | null = null

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(data)
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function handleAsk(bodyRaw: string): Promise<BridgeAskResult> {
  let parsed: { text?: string; project?: string; promptId?: string }
  try {
    parsed = JSON.parse(bodyRaw || '{}') as typeof parsed
  } catch {
    throw new Error('Invalid JSON body')
  }
  const text = (parsed.text ?? '').trim()
  if (!text) throw new Error('text is required')

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

async function onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase()
  const url = new URL(req.url ?? '/', `http://${BRIDGE_HOST}:${BRIDGE_PORT}`)
  const pathname = url.pathname.replace(/\/$/, '') || '/'

  if (method === 'OPTIONS') {
    json(res, 204, {})
    return
  }

  try {
    if (method === 'GET' && (pathname === '/health' || pathname === '/')) {
      json(res, 200, {
        ok: true,
        name: 'Vault Bridge',
        version: BRIDGE_VERSION,
        host: BRIDGE_HOST,
        port: BRIDGE_PORT,
      })
      return
    }

    if (method === 'GET' && pathname === '/v1/projects') {
      json(res, 200, { projects: listProjectsSummary() })
      return
    }

    if (method === 'POST' && pathname === '/v1/ask') {
      const body = await readBody(req)
      const result = await handleAsk(body)
      json(res, 200, result)
      return
    }

    json(res, 404, { error: 'Not found', path: pathname })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    json(res, 400, { error: msg })
  }
}

/** Start the loopback-only Bridge HTTP server (idempotent). */
export function startBridgeServer(port: number = BRIDGE_PORT): http.Server {
  if (server) return server

  server = http.createServer((req, res) => {
    void onRequest(req, res)
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
