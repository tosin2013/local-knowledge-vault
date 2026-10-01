/**
 * In-app MCP client for Vault — Streamable HTTP / SSE with OAuth via the SDK's
 * `authProvider` (RFC 9728 protected-resource metadata, RFC 8414 / OIDC
 * authorization-server discovery, RFC 8707 `resource`, PKCE, dynamic client
 * registration and token refresh are all delegated to the SDK). App-specific
 * pieces — the loopback redirect listener + state check, `shell.openExternal`
 * restricted to http(s), and encrypted client/token storage — stay here (#103).
 *
 * TODO(ask-chat): Wire connected MCP tools into Ask chat as optional tool sources.
 * Future: local stdio MCP servers.
 */
import { randomBytes } from 'crypto'
import fs from 'fs'
import http from 'http'
import path from 'path'
import os from 'os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
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

/** Active loopback OAuth wait — `cancelMcpAuth` settles it. */
type AuthWaiter = {
  state: string
  resolve: (code: string) => void
  reject: (err: Error) => void
}
let authWaiter: AuthWaiter | null = null
let callbackServer: http.Server | null = null

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

function persistTokens(id: string, tokens: TokenBundle): void {
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

/** Convert the SDK's token shape into the persisted bundle (absolute expiry). */
function tokensToBundle(tokens: OAuthTokens, previous?: TokenBundle): TokenBundle {
  const expires_at =
    typeof tokens.expires_in === 'number' && tokens.expires_in > 0
      ? Date.now() + tokens.expires_in * 1000
      : previous?.expires_at
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? previous?.refresh_token,
    token_type: tokens.token_type ?? 'Bearer',
    expires_at,
    scope: tokens.scope ?? previous?.scope,
    // Notion-specific identity only survives as long as it was already stored;
    // the SDK's spec-compliant token parsing does not carry these extras.
    user_id: previous?.user_id,
    workspace_id: previous?.workspace_id,
    email_domain: previous?.email_domain,
  }
}

/** Convert a persisted bundle back into the SDK's token shape (relative expiry). */
function bundleToTokens(bundle: TokenBundle): OAuthTokens | undefined {
  if (!bundle?.access_token) return undefined
  const expires_in =
    bundle.expires_at != null
      ? Math.max(0, Math.floor((bundle.expires_at - Date.now()) / 1000))
      : undefined
  return {
    access_token: bundle.access_token,
    token_type: bundle.token_type ?? 'Bearer',
    refresh_token: bundle.refresh_token,
    expires_in,
    scope: bundle.scope,
  }
}

/** Open the authorization URL in the user's browser, restricted to http(s). */
async function openExternal(url: string): Promise<void> {
  assertHttpUrl(url, 'authorization_endpoint')
  // Lazy require so the smoke tests can run outside a real Electron renderer.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { shell } = require('electron') as { shell: { openExternal: (u: string) => Promise<void> } }
  await shell.openExternal(url)
}

/** Start the loopback callback server once and leave it running. */
function ensureCallbackServer(): http.Server {
  if (callbackServer) return callbackServer

  const page = (title: string, body: string) =>
    `<!doctype html><html><body style="font-family:system-ui;padding:2rem;background:#0F1419;color:#e7ecf3">
      <h2>${title}</h2><p>${body}</p></body></html>`

  callbackServer = http.createServer((req, res) => {
    const settle = (waiter: AuthWaiter | null, result: { error?: string; code?: string }) => {
      authWaiter = null
      if (result.error) waiter?.reject(new Error(result.error))
      else if (result.code) waiter?.resolve(result.code)
    }
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
      const error_description = u.searchParams.get('error_description') || undefined
      const waiter = authWaiter

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(page('Authorization failed', error_description || error))
        settle(waiter, { error: error_description || error })
        return
      }
      if (!code || !state) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(page('Authorization failed', 'Missing code'))
        settle(waiter, { error: 'Missing code' })
        return
      }
      if (waiter && state !== waiter.state) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(page('Authorization failed', 'Invalid state'))
        settle(waiter, { error: 'State mismatch' })
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(page('Vault connected', 'You can close this window and return to Vault.'))
      settle(waiter, { code })
    } catch (e) {
      res.writeHead(500)
      res.end('Error')
      settle(authWaiter, { error: e instanceof Error ? e.message : String(e) })
    }
  })

  callbackServer.on('error', () => {
    /* port-in-use etc.: the pending wait rejects via cancel/auth error paths */
  })
  callbackServer.listen(CALLBACK_PORT, '127.0.0.1')
  return callbackServer
}

/**
 * Implements the SDK's `OAuthClientProvider` for one MCP server, keeping the
 * app-specific loopback redirect, state check, and encrypted storage.
 */
class VaultOAuthProvider implements OAuthClientProvider {
  readonly id: string
  private server: StoredServer
  private pendingCode: Promise<string> | null = null
  private verifier: string | null = null

  constructor(id: string, server: StoredServer) {
    this.id = id
    this.server = server
  }

  get redirectUrl(): string {
    return redirectUri()
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [redirectUri()],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: CLIENT_NAME,
      client_uri: CLIENT_URI,
    }
  }

  state(): string {
    return generateState()
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const c = this.server.client
    if (!c?.client_id) return undefined
    return {
      client_id: c.client_id,
      client_secret: c.client_secret,
      client_id_issued_at: c.client_id_issued_at,
      client_secret_expires_at: c.client_secret_expires_at,
    }
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.server = updateServer(this.id, {
      client: {
        client_id: info.client_id,
        client_secret: info.client_secret,
        client_id_issued_at: info.client_id_issued_at,
        client_secret_expires_at: info.client_secret_expires_at,
        redirect_uri: redirectUri(),
      },
    })
  }

  tokens(): OAuthTokens | undefined {
    const bundle = getTokens(this.id)
    return bundle ? bundleToTokens(bundle) : undefined
  }

  saveTokens(tokens: OAuthTokens): void {
    persistTokens(this.id, tokensToBundle(tokens, getTokens(this.id)))
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.verifier = codeVerifier
  }

  async codeVerifier(): Promise<string> {
    if (!this.verifier) throw new Error('Missing PKCE code verifier')
    return this.verifier
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    const state = authorizationUrl.searchParams.get('state') ?? ''
    assertHttpUrl(authorizationUrl.toString(), 'authorization_endpoint')
    ensureCallbackServer()
    this.pendingCode = new Promise<string>((resolve, reject) => {
      authWaiter = { state, resolve, reject }
    })
    await openExternal(authorizationUrl.toString())
  }

  /** Resolve with the authorization code captured by the loopback listener. */
  waitForCode(): Promise<string> {
    if (!this.pendingCode) throw new Error('No pending OAuth authorization')
    return this.pendingCode
  }
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
  provider: VaultOAuthProvider
): Promise<LiveSession> {
  const makeTransport = (kind: 'streamable-http' | 'sse') => {
    const url = kind === 'streamable-http' ? new URL(mcpUrl) : new URL(sseUrlFromMcp(mcpUrl))
    const opts = {
      authProvider: provider,
      requestInit: { headers: { 'User-Agent': USER_AGENT } },
    }
    return kind === 'streamable-http'
      ? new StreamableHTTPClientTransport(url, opts)
      : new SSEClientTransport(url, opts)
  }

  const connectOnce = async (kind: 'streamable-http' | 'sse'): Promise<LiveSession> => {
    let transport = makeTransport(kind)
    let client = new Client({ name: CLIENT_NAME, version: '1.0.0' }, { capabilities: {} })

    try {
      await client.connect(transport)
    } catch (e) {
      if (!(e instanceof UnauthorizedError)) throw e
      // Interactive auth: the provider opened the browser. Wait for the loopback
      // code, exchange it via finishAuth, then retry with a fresh client+transport
      // (the SDK's Client.connect can only start a transport once).
      try {
        await client.close()
      } catch {
        /* ignore */
      }
      statusOverride.set(provider.id, {
        status: 'authorizing',
        error: 'Waiting for authorization in browser…',
      })
      const code = await provider.waitForCode()
      await transport.finishAuth(code)
      statusOverride.delete(provider.id)
      transport = makeTransport(kind)
      client = new Client({ name: CLIENT_NAME, version: '1.0.0' }, { capabilities: {} })
      await client.connect(transport)
    }

    const listed = await client.listTools()
    const tools: McpToolSummary[] = (listed.tools || []).map((t) => ({
      name: t.name,
      description: t.description,
    }))
    return { client, tools, transport: kind }
  }

  try {
    return await connectOnce('streamable-http')
  } catch (err) {
    console.warn('[mcp] Streamable HTTP failed, falling back to SSE:', err)
    return await connectOnce('sse')
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
  if (authWaiter) {
    authWaiter.reject(new Error('Sign-in cancelled'))
    authWaiter = null
  }
  statusOverride.set(id, {
    status: 'needs_auth',
    error: 'Sign-in cancelled — click Connect to try again',
  })
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
  const server = getServer(id)
  if (!server) throw new Error(`MCP server not found: ${id}`)

  statusOverride.delete(id)
  await disconnectLive(id)

  const provider = new VaultOAuthProvider(id, server)
  try {
    const session = await connectMcpSession(server.url, provider)
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
  // The transport re-authenticates (refresh or re-auth) on a 401 mid-session.
  const listed = await session.client.listTools()
  const tools: McpToolSummary[] = (listed.tools || []).map((t) => ({
    name: t.name,
    description: t.description,
  }))
  session.tools = tools
  return tools
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
