/**
 * In-app MCP client for Vault — OAuth (PKCE + dynamic registration) + Streamable HTTP / SSE.
 * Follows Notion's "Build an MCP client for Notion" guide (RFC 9470 → 8414 → 7591).
 *
 * TODO(ask-chat): Wire connected MCP tools into Ask chat as optional tool sources.
 * Future: local stdio MCP servers.
 */
import { createHash, randomBytes } from 'crypto'
import fs from 'fs'
import http from 'http'
import path from 'path'
import os from 'os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { encryptSecret, decryptSecret } from './secret-store'
import type {
  McpAddServerInput,
  McpCallToolResult,
  McpConnectResult,
  McpServerStatus,
  McpServerSummary,
  McpToolSummary,
} from './types'

const CLIENT_NAME = 'Vault'
const CLIENT_URI = 'https://github.com/local-knowledge-vault'
const USER_AGENT = 'Vault-MCP-Client/1.0'
const CALLBACK_PATH = '/oauth/callback'
/** Fixed loopback port so dynamic client registration redirects stay stable across sessions. */
const CALLBACK_PORT = 17342
const SERVERS_FILE = 'mcp-servers.json'
const TOKENS_FILE = 'mcp-tokens.json'
const NOTION_MCP_URL = 'https://mcp.notion.com/mcp'
const NOTION_PRESET_ID = 'notion'
const REFRESH_SKEW_MS = 5 * 60 * 1000

export type OAuthMetadata = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  code_challenge_methods_supported?: string[]
  grant_types_supported?: string[]
  response_types_supported?: string[]
  scopes_supported?: string[]
}

type ClientCredentials = {
  client_id: string
  client_secret?: string
  client_id_issued_at?: number
  client_secret_expires_at?: number
  redirect_uri: string
}

type TokenBundle = {
  access_token: string
  refresh_token?: string
  token_type?: string
  expires_at?: number
  scope?: string
  user_id?: string
  workspace_id?: string
  email_domain?: string
}

type StoredServer = {
  id: string
  name: string
  url: string
  preset?: 'notion' | null
  client?: ClientCredentials
  oauthMetadataCache?: OAuthMetadata
}

type StoredServersFile = { servers: StoredServer[] }

type TokensFile = Record<string, TokenBundle>

type LiveSession = {
  client: Client
  tools: McpToolSummary[]
  transport: 'streamable-http' | 'sse'
}

let userDataOverride: string | null = null
const live = new Map<string, LiveSession>()
const statusOverride = new Map<string, { status: McpServerStatus; error?: string }>()
const refreshLocks = new Map<string, Promise<TokenBundle>>()
/** Active OAuth loopback waiters — cancelAuth settles these. */
const oauthCancelers = new Map<string, () => void>()

export function setMcpUserDataDir(dir: string | null): void {
  userDataOverride = dir
}

function resolveUserDataDir(): string {
  if (userDataOverride) return userDataOverride
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { app?: { getPath: (n: string) => string } }
    if (electron?.app?.getPath) return electron.app.getPath('userData')
  } catch {
    /* not in Electron */
  }
  const fallback = path.join(os.tmpdir(), 'lkv-userdata')
  fs.mkdirSync(fallback, { recursive: true })
  return fallback
}

function serversPath(): string {
  return path.join(resolveUserDataDir(), SERVERS_FILE)
}

function tokensPath(): string {
  return path.join(resolveUserDataDir(), TOKENS_FILE)
}

function redirectUri(): string {
  return `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`
}

function base64URLEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function generateCodeVerifier(): string {
  return base64URLEncode(randomBytes(32))
}

function generateCodeChallenge(verifier: string): string {
  return base64URLEncode(createHash('sha256').update(verifier).digest())
}

function generateState(): string {
  return randomBytes(24).toString('hex')
}

function generateId(): string {
  return `mcp_${randomBytes(8).toString('hex')}`
}

function readServersFile(): StoredServersFile {
  try {
    const p = serversPath()
    if (!fs.existsSync(p)) return { servers: [] }
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as StoredServersFile
    return {
      servers: (Array.isArray(raw.servers) ? raw.servers : []).map((s) => {
        if (s?.client?.client_secret) {
          const secret = decryptSecret(s.client.client_secret)
          return { ...s, client: { ...s.client, client_secret: secret ?? undefined } }
        }
        return s
      }),
    }
  } catch {
    return { servers: [] }
  }
}

function writeServersFile(data: StoredServersFile): void {
  const dir = resolveUserDataDir()
  fs.mkdirSync(dir, { recursive: true })
  const safe: StoredServersFile = {
    servers: data.servers.map((s) =>
      s?.client?.client_secret
        ? { ...s, client: { ...s.client, client_secret: encryptSecret(s.client.client_secret) } }
        : s
    ),
  }
  fs.writeFileSync(serversPath(), JSON.stringify(safe, null, 2), 'utf8')
}

function readTokensFile(): TokensFile {
  try {
    const p = tokensPath()
    if (!fs.existsSync(p)) return {}
    const decrypted = decryptSecret(fs.readFileSync(p, 'utf8'))
    if (!decrypted) return {}
    return JSON.parse(decrypted) as TokensFile
  } catch {
    return {}
  }
}

function writeTokensFile(data: TokensFile): void {
  const dir = resolveUserDataDir()
  fs.mkdirSync(dir, { recursive: true })
  const p = tokensPath()
  const stored = encryptSecret(JSON.stringify(data, null, 2))
  fs.writeFileSync(p, stored, { encoding: 'utf8', mode: 0o600 })
  try {
    fs.chmodSync(p, 0o600)
  } catch {
    /* best-effort on platforms without chmod */
  }
}

function ensureNotionPreset(): void {
  const data = readServersFile()
  if (data.servers.some((s) => s.id === NOTION_PRESET_ID || s.preset === 'notion')) return
  data.servers.unshift({
    id: NOTION_PRESET_ID,
    name: 'Notion',
    url: NOTION_MCP_URL,
    preset: 'notion',
  })
  writeServersFile(data)
}

function getServer(id: string): StoredServer | undefined {
  ensureNotionPreset()
  return readServersFile().servers.find((s) => s.id === id)
}

function updateServer(id: string, patch: Partial<StoredServer>): StoredServer {
  const data = readServersFile()
  const idx = data.servers.findIndex((s) => s.id === id)
  if (idx < 0) throw new Error(`MCP server not found: ${id}`)
  data.servers[idx] = { ...data.servers[idx], ...patch, id }
  writeServersFile(data)
  return data.servers[idx]
}

function getTokens(id: string): TokenBundle | undefined {
  return readTokensFile()[id]
}

function saveTokens(id: string, tokens: TokenBundle): void {
  const all = readTokensFile()
  all[id] = tokens
  writeTokensFile(all)
}

function clearTokens(id: string): void {
  const all = readTokensFile()
  delete all[id]
  writeTokensFile(all)
}

/** Reject non-http(s) endpoint URLs from untrusted server metadata. */
function assertHttpUrl(value: string, label: string): void {
  let scheme = 'invalid URL'
  try {
    const u = new URL(value)
    scheme = u.protocol || 'invalid URL'
    if (u.protocol === 'http:' || u.protocol === 'https:') return
  } catch {
    /* scheme already set to 'invalid URL' */
  }
  throw new Error(`OAuth ${label} must be an http(s) URL (got ${scheme})`)
}

/**
 * RFC 9470 protected-resource metadata discovery with common fallbacks.
 * Prefer path-aware well-known: /.well-known/oauth-protected-resource{path}
 */
export async function discoverOAuthMetadata(mcpServerUrl: string): Promise<OAuthMetadata> {
  const url = new URL(mcpServerUrl)
  const candidates: string[] = []

  // RFC 9470 path-aware
  const pathPart = url.pathname.replace(/\/$/, '')
  if (pathPart && pathPart !== '/') {
    candidates.push(`${url.origin}/.well-known/oauth-protected-resource${pathPart}`)
  }
  candidates.push(`${url.origin}/.well-known/oauth-protected-resource`)
  // Some hosts publish under the resource path itself
  candidates.push(new URL('/.well-known/oauth-protected-resource', url).toString())
  if (!url.pathname.endsWith('/')) {
    candidates.push(`${mcpServerUrl}/.well-known/oauth-protected-resource`)
  }

  let authServers: string[] | undefined
  let lastErr = ''
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      })
      if (!res.ok) {
        lastErr = `${candidate} → ${res.status}`
        continue
      }
      const body = (await res.json()) as { authorization_servers?: string[] }
      if (Array.isArray(body.authorization_servers) && body.authorization_servers.length > 0) {
        authServers = body.authorization_servers
        break
      }
      lastErr = `${candidate} → no authorization_servers`
    } catch (e) {
      lastErr = `${candidate} → ${e instanceof Error ? e.message : String(e)}`
    }
  }

  if (!authServers?.length) {
    throw new Error(`OAuth protected-resource discovery failed (${lastErr})`)
  }

  const authServerUrl = authServers[0]
  const metadataUrl = new URL('/.well-known/oauth-authorization-server', authServerUrl)
  const metadataResponse = await fetch(metadataUrl.toString(), {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  })
  if (!metadataResponse.ok) {
    throw new Error(
      `Failed to fetch authorization server metadata: ${metadataResponse.status}`
    )
  }
  const metadata = (await metadataResponse.json()) as OAuthMetadata
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error('Missing required OAuth endpoints in metadata')
  }
  // Untrusted server metadata must not point at arbitrary URL schemes — the
  // authorization_endpoint is handed to shell.openExternal, which would open
  // file://, smb://, or custom schemes, and the others are used with fetch.
  assertHttpUrl(metadata.authorization_endpoint, 'authorization_endpoint')
  assertHttpUrl(metadata.token_endpoint, 'token_endpoint')
  if (metadata.registration_endpoint) {
    assertHttpUrl(metadata.registration_endpoint, 'registration_endpoint')
  }
  if (!metadata.code_challenge_methods_supported?.includes('S256')) {
    console.warn('[mcp] Server does not advertise S256 PKCE; using S256 anyway')
  }
  return metadata
}

async function registerClient(
  metadata: OAuthMetadata,
  redirect: string
): Promise<ClientCredentials> {
  if (!metadata.registration_endpoint) {
    throw new Error('Server does not support dynamic client registration')
  }
  const registrationRequest = {
    client_name: CLIENT_NAME,
    client_uri: CLIENT_URI,
    redirect_uris: [redirect],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: metadata.scopes_supported?.includes('default')
      ? 'default'
      : (metadata.scopes_supported?.[0] ?? undefined),
  }
  const response = await fetch(metadata.registration_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify(registrationRequest),
  })
  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Client registration failed: ${response.status} - ${errorBody}`)
  }
  const credentials = (await response.json()) as {
    client_id: string
    client_secret?: string
    client_id_issued_at?: number
    client_secret_expires_at?: number
  }
  if (!credentials.client_id) throw new Error('Registration response missing client_id')
  return {
    client_id: credentials.client_id,
    client_secret: credentials.client_secret,
    client_id_issued_at: credentials.client_id_issued_at,
    client_secret_expires_at: credentials.client_secret_expires_at,
    redirect_uri: redirect,
  }
}

function buildAuthorizationUrl(
  metadata: OAuthMetadata,
  clientId: string,
  redirect: string,
  codeChallenge: string,
  state: string,
  scopes: string[]
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirect,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'consent',
  })
  if (scopes.length) params.set('scope', scopes.join(' '))
  return `${metadata.authorization_endpoint}?${params.toString()}`
}

type TokenResponse = {
  access_token: string
  token_type?: string
  expires_in?: number
  refresh_token?: string
  scope?: string
  user_id?: string
  workspace_id?: string
  email_domain?: string
  error?: string
  error_description?: string
}

async function postToken(
  metadata: OAuthMetadata,
  params: URLSearchParams,
  clientSecret?: string
): Promise<TokenResponse> {
  if (clientSecret) params.set('client_secret', clientSecret)
  const response = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: params.toString(),
  })
  const text = await response.text()
  let body: TokenResponse
  try {
    body = JSON.parse(text) as TokenResponse
  } catch {
    throw new Error(`Token endpoint returned non-JSON: ${response.status} ${text.slice(0, 200)}`)
  }
  if (!response.ok) {
    if (body.error === 'invalid_grant') {
      const err = new Error('REAUTH_REQUIRED')
      ;(err as Error & { code?: string }).code = 'invalid_grant'
      throw err
    }
    throw new Error(
      `Token request failed: ${response.status} - ${body.error || text.slice(0, 200)}`
    )
  }
  if (!body.access_token) throw new Error('Missing access_token in response')
  return body
}

function tokenResponseToBundle(
  tokens: TokenResponse,
  previous?: TokenBundle
): TokenBundle {
  const expires_at =
    typeof tokens.expires_in === 'number'
      ? Date.now() + tokens.expires_in * 1000
      : previous?.expires_at
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? previous?.refresh_token,
    token_type: tokens.token_type ?? 'Bearer',
    expires_at,
    scope: tokens.scope ?? previous?.scope,
    // Identity only on auth-code exchange; keep prior on refresh
    user_id: tokens.user_id ?? previous?.user_id,
    workspace_id: tokens.workspace_id ?? previous?.workspace_id,
    email_domain: tokens.email_domain ?? previous?.email_domain,
  }
}

async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  metadata: OAuthMetadata,
  client: ClientCredentials
): Promise<TokenBundle> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: client.client_id,
    redirect_uri: client.redirect_uri,
    code_verifier: codeVerifier,
  })
  const tokens = await postToken(metadata, params, client.client_secret)
  return tokenResponseToBundle(tokens)
}

async function refreshAccessToken(
  refreshToken: string,
  metadata: OAuthMetadata,
  client: ClientCredentials,
  previous?: TokenBundle
): Promise<TokenBundle> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.client_id,
  })
  const tokens = await postToken(metadata, params, client.client_secret)
  return tokenResponseToBundle(tokens, previous)
}

async function ensureValidTokens(
  id: string,
  server: StoredServer,
  metadata: OAuthMetadata
): Promise<TokenBundle> {
  const existing = getTokens(id)
  if (!existing?.access_token) {
    throw Object.assign(new Error('No tokens — authorization required'), {
      code: 'needs_auth',
    })
  }
  const stillValid =
    existing.expires_at && existing.expires_at > Date.now() + REFRESH_SKEW_MS
  if (stillValid) return existing
  if (!existing.refresh_token) {
    clearTokens(id)
    statusOverride.set(id, { status: 'needs_auth', error: 'Session expired' })
    throw Object.assign(new Error('REAUTH_REQUIRED'), { code: 'invalid_grant' })
  }
  if (!server.client) {
    throw Object.assign(new Error('Missing client credentials'), { code: 'needs_auth' })
  }

  const pending = refreshLocks.get(id)
  if (pending) return pending

  const job = (async () => {
    try {
      const next = await refreshAccessToken(
        existing.refresh_token!,
        metadata,
        server.client!,
        existing
      )
      // Persist rotated refresh token atomically before use
      saveTokens(id, next)
      return next
    } catch (e) {
      if (e instanceof Error && (e.message === 'REAUTH_REQUIRED' || (e as Error & { code?: string }).code === 'invalid_grant')) {
        clearTokens(id)
        statusOverride.set(id, {
          status: 'needs_auth',
          error: 'Re-authorization required',
        })
      }
      throw e
    } finally {
      refreshLocks.delete(id)
    }
  })()
  refreshLocks.set(id, job)
  return job
}

type CallbackResult = { code: string; state: string } | { error: string; error_description?: string }

/**
 * Run loopback OAuth: listen → open browser → wait for code → exchange → close.
 */
async function runOAuthFlow(
  id: string,
  server: StoredServer,
  metadata: OAuthMetadata,
  client: ClientCredentials
): Promise<TokenBundle> {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)
  const state = generateState()
  const scopes =
    metadata.scopes_supported?.includes('default')
      ? ['default']
      : metadata.scopes_supported?.slice(0, 1) ?? []

  const authUrl = buildAuthorizationUrl(
    metadata,
    client.client_id,
    client.redirect_uri,
    codeChallenge,
    state,
    scopes
  )

  const { waitForCode, close, cancel } = await listenForCallback(state)
  statusOverride.set(id, {
    status: 'authorizing',
    error: 'Waiting for authorization in browser…',
  })
  oauthCancelers.set(id, cancel)

  try {
    // Lazy require so discovery smoke can run outside Electron
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { shell } = require('electron') as { shell: { openExternal: (url: string) => Promise<void> } }
    // Final guard: never hand a non-http(s) URL to shell.openExternal, even if the
    // cached metadata was tampered with on disk after discovery.
    assertHttpUrl(metadata.authorization_endpoint, 'authorization_endpoint')
    await shell.openExternal(authUrl)
    const result = await waitForCode
    if ('error' in result) {
      const friendly =
        result.error === 'cancelled'
          ? 'Sign-in cancelled'
          : result.error === 'timeout'
            ? 'Sign-in timed out — try Connect again'
            : `OAuth error: ${result.error}${result.error_description ? ` — ${result.error_description}` : ''}`
      statusOverride.set(id, {
        status: result.error === 'cancelled' || result.error === 'timeout' ? 'needs_auth' : 'error',
        error: friendly,
      })
      throw new Error(friendly)
    }
    const tokens = await exchangeCodeForTokens(
      result.code,
      codeVerifier,
      metadata,
      client
    )
    saveTokens(id, tokens)
    statusOverride.delete(id)
    return tokens
  } catch (e) {
    // Preserve statusOverride set above for cancel/timeout; otherwise mark failed
    const override = statusOverride.get(id)
    if (!override || override.status === 'authorizing') {
      const msg = e instanceof Error ? e.message : String(e)
      statusOverride.set(id, { status: 'error', error: msg })
    }
    throw e
  } finally {
    oauthCancelers.delete(id)
    await close()
  }
}

function listenForCallback(expectedState: string): Promise<{
  waitForCode: Promise<CallbackResult>
  close: () => Promise<void>
  cancel: () => void
}> {
  return new Promise((resolveListen, rejectListen) => {
    let settleCode: ((r: CallbackResult) => void) | null = null
    let settled = false
    const waitForCode = new Promise<CallbackResult>((resolve) => {
      settleCode = (r) => {
        if (settled) return
        settled = true
        resolve(r)
      }
    })

    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url || '/', `http://127.0.0.1:${CALLBACK_PORT}`)
        if (u.pathname !== CALLBACK_PATH) {
          res.writeHead(404)
          res.end('Not found')
          return
        }
        const code = u.searchParams.get('code') || undefined
        const state = u.searchParams.get('state') || undefined
        const error = u.searchParams.get('error') || undefined
        const error_description =
          u.searchParams.get('error_description') || undefined

        const page = (title: string, body: string) =>
          `<!doctype html><html><body style="font-family:system-ui;padding:2rem;background:#0F1419;color:#e7ecf3">
            <h2>${title}</h2><p>${body}</p></body></html>`

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(page('Authorization failed', error_description || error))
          settleCode?.({ error, error_description })
          return
        }
        if (!code || !state) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(page('Authorization failed', 'Missing code'))
          settleCode?.({ error: 'missing_code' })
          return
        }
        if (state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(page('Authorization failed', 'Invalid state'))
          settleCode?.({ error: 'invalid_state', error_description: 'State mismatch' })
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(page('Vault connected', 'You can close this window and return to Vault.'))
        settleCode?.({ code, state })
      } catch (e) {
        res.writeHead(500)
        res.end('Error')
        settleCode?.({ error: e instanceof Error ? e.message : String(e) })
      }
    })

    const timer = setTimeout(() => {
      settleCode?.({ error: 'timeout', error_description: 'OAuth timed out' })
      server.close()
    }, 5 * 60 * 1000)

    const close = (): Promise<void> =>
      new Promise((resClose) => {
        clearTimeout(timer)
        server.close(() => resClose())
      })

    const cancel = () => {
      settleCode?.({ error: 'cancelled', error_description: 'Cancelled by user' })
      server.close()
    }

    server.on('error', (err) => {
      clearTimeout(timer)
      rejectListen(err)
    })

    server.listen(CALLBACK_PORT, '127.0.0.1', () => {
      resolveListen({ waitForCode, close, cancel })
    })
  })
}

function sseUrlFromMcp(mcpUrl: string): string {
  try {
    const u = new URL(mcpUrl)
    if (u.pathname.endsWith('/mcp')) {
      u.pathname = u.pathname.replace(/\/mcp$/, '/sse')
      return u.toString()
    }
    if (u.pathname.endsWith('/')) u.pathname = `${u.pathname}sse`
    else u.pathname = `${u.pathname}/sse`
    return u.toString()
  } catch {
    return mcpUrl.replace(/\/mcp\/?$/, '/sse')
  }
}

async function connectMcpSession(
  mcpUrl: string,
  accessToken?: string
): Promise<LiveSession> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
  }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  const tryStreamable = async (): Promise<LiveSession> => {
    const client = new Client(
      { name: CLIENT_NAME, version: '1.0.0' },
      { capabilities: {} }
    )
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
      requestInit: { headers },
    })
    await client.connect(transport)
    const listed = await client.listTools()
    const tools: McpToolSummary[] = (listed.tools || []).map((t) => ({
      name: t.name,
      description: t.description,
    }))
    return { client, tools, transport: 'streamable-http' }
  }

  const trySse = async (): Promise<LiveSession> => {
    const client = new Client(
      { name: CLIENT_NAME, version: '1.0.0' },
      { capabilities: {} }
    )
    const transport = new SSEClientTransport(new URL(sseUrlFromMcp(mcpUrl)), {
      requestInit: { headers },
    })
    await client.connect(transport)
    const listed = await client.listTools()
    const tools: McpToolSummary[] = (listed.tools || []).map((t) => ({
      name: t.name,
      description: t.description,
    }))
    return { client, tools, transport: 'sse' }
  }

  try {
    return await tryStreamable()
  } catch (err) {
    console.warn('[mcp] Streamable HTTP failed, falling back to SSE:', err)
    return await trySse()
  }
}

async function disconnectLive(id: string): Promise<void> {
  const session = live.get(id)
  if (!session) return
  live.delete(id)
  try {
    await session.client.close()
  } catch {
    /* ignore */
  }
}

function summarizeServer(s: StoredServer): McpServerSummary {
  const tokens = getTokens(s.id)
  const override = statusOverride.get(s.id)
  const session = live.get(s.id)
  let status: McpServerStatus = 'disconnected'
  let error: string | undefined

  if (override) {
    status = override.status
    error = override.error
  } else if (session) {
    status = 'connected'
  } else if (tokens?.access_token) {
    status = 'disconnected'
  } else if (s.client) {
    status = 'needs_auth'
  } else {
    status = 'disconnected'
  }

  return {
    id: s.id,
    name: s.name,
    url: s.url,
    status,
    toolCount: session?.tools.length,
    error,
    workspaceId: tokens?.workspace_id,
    userId: tokens?.user_id,
    emailDomain: tokens?.email_domain,
    preset: s.preset ?? null,
  }
}

export function listMcpServers(): McpServerSummary[] {
  ensureNotionPreset()
  return readServersFile().servers.map(summarizeServer)
}

export function addMcpServer(input: McpAddServerInput): McpServerSummary {
  const name = (input.name || '').trim()
  const url = (input.url || '').trim()
  if (!name) throw new Error('Name is required')
  if (!url) throw new Error('URL is required')
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid MCP server URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('MCP URL must be http(s)')
  }
  ensureNotionPreset()
  const data = readServersFile()
  const existing = data.servers.find(
    (s) => s.url.replace(/\/$/, '') === url.replace(/\/$/, '')
  )
  if (existing) return summarizeServer(existing)
  const server: StoredServer = {
    id: generateId(),
    name,
    url,
    preset: null,
  }
  data.servers.push(server)
  writeServersFile(data)
  return summarizeServer(server)
}

/** Ensure Notion preset exists and return its id (for Connect Notion CTA). */
export function ensureNotionServer(): McpServerSummary {
  ensureNotionPreset()
  const s = getServer(NOTION_PRESET_ID)
  if (!s) throw new Error('Failed to seed Notion preset')
  return summarizeServer(s)
}

export async function removeMcpServer(id: string): Promise<boolean> {
  await disconnectLive(id)
  clearTokens(id)
  statusOverride.delete(id)
  const data = readServersFile()
  const before = data.servers.length
  data.servers = data.servers.filter((s) => s.id !== id)
  writeServersFile(data)
  return data.servers.length < before
}


export function cancelMcpAuth(id: string): McpServerSummary | null {
  const cancel = oauthCancelers.get(id)
  if (cancel) {
    cancel()
    statusOverride.set(id, {
      status: 'needs_auth',
      error: 'Sign-in cancelled — click Connect to try again',
    })
  } else if (statusOverride.get(id)?.status === 'authorizing') {
    statusOverride.set(id, {
      status: 'needs_auth',
      error: 'Sign-in cancelled — click Connect to try again',
    })
  }
  const s = getServer(id)
  return s ? summarizeServer(s) : null
}

export async function disconnectMcpServer(id: string): Promise<McpServerSummary> {
  await disconnectLive(id)
  const s = getServer(id)
  if (!s) throw new Error(`MCP server not found: ${id}`)
  statusOverride.set(id, { status: 'disconnected' })
  return summarizeServer(s)
}

export async function connectMcpServer(id: string): Promise<McpConnectResult> {
  ensureNotionPreset()
  let server = getServer(id)
  if (!server) throw new Error(`MCP server not found: ${id}`)

  statusOverride.delete(id)

  let metadata: OAuthMetadata | undefined = server.oauthMetadataCache
  let discoveryError: string | undefined
  try {
    metadata = await discoverOAuthMetadata(server.url)
    server = updateServer(id, { oauthMetadataCache: metadata })
  } catch (e) {
    discoveryError = e instanceof Error ? e.message : String(e)
    if (!metadata) metadata = undefined
  }

  const requiresOauth =
    server.preset === 'notion' ||
    Boolean(metadata?.registration_endpoint) ||
    Boolean(getTokens(id)?.access_token) ||
    Boolean(server.client)

  let accessToken: string | undefined

  if (requiresOauth || metadata?.registration_endpoint) {
    if (!metadata) {
      const msg = discoveryError || 'OAuth discovery failed'
      statusOverride.set(id, { status: 'error', error: msg })
      throw new Error(msg)
    }

    // Reuse dynamic client registration across sessions
    let clientCreds = server.client
    const redirect = redirectUri()
    if (!clientCreds || clientCreds.redirect_uri !== redirect) {
      clientCreds = await registerClient(metadata, redirect)
      server = updateServer(id, { client: clientCreds })
    }

    let tokens = getTokens(id)
    if (!tokens?.access_token) {
      tokens = await runOAuthFlow(id, server, metadata, clientCreds)
    } else {
      try {
        tokens = await ensureValidTokens(id, server, metadata)
      } catch (e) {
        if (
          e instanceof Error &&
          (e.message === 'REAUTH_REQUIRED' ||
            (e as Error & { code?: string }).code === 'invalid_grant' ||
            (e as Error & { code?: string }).code === 'needs_auth')
        ) {
          tokens = await runOAuthFlow(id, server, metadata, clientCreds)
        } else {
          throw e
        }
      }
    }
    accessToken = tokens.access_token
  }

  await disconnectLive(id)
  try {
    const session = await connectMcpSession(server.url, accessToken)
    live.set(id, session)
    statusOverride.set(id, { status: 'connected' })
    const summary = summarizeServer(getServer(id)!)
    summary.status = 'connected'
    summary.toolCount = session.tools.length
    return { server: summary, tools: session.tools }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    statusOverride.set(id, { status: 'error', error: msg })
    throw e
  }
}

export async function listMcpTools(id: string): Promise<McpToolSummary[]> {
  const session = live.get(id)
  if (!session) throw new Error('Not connected — connect first')
  try {
    const listed = await session.client.listTools()
    const tools: McpToolSummary[] = (listed.tools || []).map((t) => ({
      name: t.name,
      description: t.description,
    }))
    session.tools = tools
    return tools
  } catch (e) {
    // Token may have expired mid-session — try refresh + reconnect once
    const server = getServer(id)
    if (!server?.oauthMetadataCache) throw e
    try {
      const tokens = await ensureValidTokens(id, server, server.oauthMetadataCache)
      await disconnectLive(id)
      const next = await connectMcpSession(server.url, tokens.access_token)
      live.set(id, next)
      return next.tools
    } catch (inner) {
      if (
        inner instanceof Error &&
        (inner.message === 'REAUTH_REQUIRED' ||
          (inner as Error & { code?: string }).code === 'invalid_grant')
      ) {
        statusOverride.set(id, {
          status: 'needs_auth',
          error: 'Re-authorization required',
        })
      }
      throw inner
    }
  }
}

export async function callMcpTool(
  id: string,
  name: string,
  args?: Record<string, unknown>
): Promise<McpCallToolResult> {
  const session = live.get(id)
  if (!session) throw new Error('Not connected — connect first')
  const result = await session.client.callTool({
    name,
    arguments: args ?? {},
  })
  return {
    content: result.content,
    isError: Boolean(result.isError),
  }
}

