/**
 * Headless MCP client smoke — a local mock Streamable-HTTP + OAuth server, no network.
 *
 * Covers the SDK-driven OAuth flow (RFC 9728 protected-resource discovery,
 * dynamic registration, PKCE, token exchange/refresh), tool listing/calls, and
 * the #103 spec-conformance requirements: a server that requires `resource`,
 * advertises resource metadata only through the 401 WWW-Authenticate header,
 * and uses an issuer URL with a path.
 *
 *   npm run test:mcp
 *
 * Runs under Electron-as-Node so better-sqlite3 (and `require('electron')`) resolve;
 * shell.openExternal is mocked via a Module._load hook so no browser opens.
 */
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import {
  setMcpUserDataDir,
  listMcpServers,
  addMcpServer,
  removeMcpServer,
  disconnectMcpServer,
  connectMcpServer,
  listMcpTools,
  callMcpTool,
} from '../electron/mcp-client'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${msg}`)
  } else {
    failed++
    console.error(`  ✗ ${msg}`)
  }
}

/** Mutable state the mock token endpoint reads, so tests can force refresh. */
const mockState = {
  expiresIn: 3600,
  refreshCount: 0,
  exchangeCount: 0,
  registrationCount: 0,
  openExternalCount: 0,
  /** Reject `mock-access-token` (simulates an expired access token) to force refresh. */
  rejectAccessToken: false,
  /** `resource` values seen by the token endpoint. */
  resources: [] as (string | null)[],
}

function mockElectronShell(): {
  nextAuthUrl: () => Promise<string>
} {
  const waiters: Array<(u: string) => void> = []
  const pending: string[] = []
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Module = require('module') as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown
  }
  const origLoad = Module._load
  Module._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === 'electron') {
      return {
        shell: {
          openExternal: async (url: string) => {
            mockState.openExternalCount++
            const w = waiters.shift()
            if (w) w(url)
            else pending.push(url)
          },
        },
      }
    }
    return origLoad.call(this, request, parent, isMain)
  }
  return {
    nextAuthUrl: () =>
      new Promise<string>((resolve) => {
        const p = pending.shift()
        if (p) resolve(p)
        else waiters.push(resolve)
      }),
  }
}

async function readRawBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const text = await readRawBody(req)
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

type MockServer = {
  origin: string
  mcpUrl: string
  close: () => Promise<void>
}

/** Register the two demo tools on a fresh McpServer. */
function registerTools(server: McpServer): void {
  server.registerTool(
    'echo',
    { description: 'Echo text back', inputSchema: { text: z.string() } },
    async (args) => ({ content: [{ type: 'text' as const, text: `echo: ${args.text}` }] }),
  )
  server.registerTool(
    'add',
    { description: 'Add two numbers', inputSchema: { a: z.number(), b: z.number() } },
    async (args) => ({
      content: [{ type: 'text' as const, text: String(args.a + args.b) }],
    }),
  )
}

/** One MCP session = a fresh server + stateful transport (a new client `initialize`). */
async function createMcpSession(): Promise<{
  server: McpServer
  transport: StreamableHTTPServerTransport
}> {
  const server = new McpServer({ name: 'Mock MCP', version: '1.0.0' })
  registerTools(server)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  })
  await server.connect(transport)
  return { server, transport }
}

async function startMockServer(options?: {
  /** Advertise protected-resource metadata only via the 401 WWW-Authenticate header. */
  wwwAuthenticateOnly?: boolean
  /** Serve the authorization server under a path (e.g. /issuer). */
  issuerPath?: boolean
  /** Token endpoint rejects requests missing `resource` (RFC 8707). */
  requireResource?: boolean
  /** Return a client_secret from dynamic registration. */
  returnClientSecret?: boolean
}): Promise<MockServer> {
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport }>()
  const issuerPath = options?.issuerPath ? '/issuer' : ''
  let origin = ''

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1')
    const p = u.pathname
    const issuer = `${origin}${issuerPath}`

    try {
      // RFC 9728 well-known (skipped when metadata is only via WWW-Authenticate).
      if (req.method === 'GET' && p === '/.well-known/oauth-protected-resource' && !options?.wwwAuthenticateOnly) {
        return json(res, 200, { resource: origin, authorization_servers: [issuer] })
      }
      // Resource metadata served at a custom URL, referenced by the 401 header.
      if (req.method === 'GET' && p === '/resource-metadata') {
        return json(res, 200, { resource: origin, authorization_servers: [issuer] })
      }
      // RFC 8414 authorization-server metadata (well-known inserted before the issuer path).
      if (req.method === 'GET' && p === `/.well-known/oauth-authorization-server${issuerPath}`) {
        return json(res, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          registration_endpoint: `${issuer}/register`,
          code_challenge_methods_supported: ['S256'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          response_types_supported: ['code'],
          scopes_supported: ['default'],
        })
      }
      if (req.method === 'POST' && p === `${issuerPath}/register`) {
        mockState.registrationCount++
        return json(res, 201, {
          client_id: 'mock-client-id',
          client_id_issued_at: 1_700_000_000,
          redirect_uris: ['http://127.0.0.1:17342/oauth/callback'],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          client_name: 'Vault',
          ...(options?.returnClientSecret ? { client_secret: 'mock-client-secret' } : {}),
        })
      }
      if (req.method === 'POST' && p === `${issuerPath}/token`) {
        const raw = await readRawBody(req)
        const params = new URLSearchParams(raw)
        const grantType = params.get('grant_type') ?? ''
        mockState.resources.push(params.get('resource'))
        if (options?.requireResource && !params.get('resource')) {
          return json(res, 400, { error: 'invalid_target', error_description: 'resource is required' })
        }
        if (grantType === 'refresh_token') mockState.refreshCount++
        else mockState.exchangeCount++
        return json(res, 200, {
          access_token: grantType === 'refresh_token' ? 'mock-refreshed-token' : 'mock-access-token',
          token_type: 'Bearer',
          expires_in: mockState.expiresIn,
          refresh_token: 'mock-refresh-token',
          scope: 'default',
        })
      }

      if (req.method === 'POST' && p === '/mcp') {
        const auth = req.headers['authorization'] || ''
        const valid =
          auth === 'Bearer mock-refreshed-token' ||
          (auth === 'Bearer mock-access-token' && !mockState.rejectAccessToken)
        if (!valid) {
          const wwwAuth = options?.wwwAuthenticateOnly
            ? `Bearer resource_metadata="${origin}/resource-metadata"`
            : 'Bearer'
          res.writeHead(401, { 'WWW-Authenticate': wwwAuth })
          res.end()
          return
        }
        const body = await readJsonBody(req)
        const msg = Array.isArray(body) ? body[0] : body
        const sid = req.headers['mcp-session-id'] as string | undefined
        if (!sid && msg && (msg as { method?: string }).method === 'initialize') {
          const session = await createMcpSession()
          await session.transport.handleRequest(req, res, body)
          if (session.transport.sessionId) sessions.set(session.transport.sessionId, session)
          return
        }
        if (sid && sessions.has(sid)) {
          await sessions.get(sid)!.transport.handleRequest(req, res, body)
          return
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not found')
        return
      }
      if ((req.method === 'DELETE' || req.method === 'GET') && p === '/mcp') {
        const sid = req.headers['mcp-session-id'] as string | undefined
        const session = sid ? sessions.get(sid) : undefined
        if (session) {
          await session.transport.handleRequest(req, res)
          if (req.method === 'DELETE' && sid) sessions.delete(sid)
          return
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not found')
        return
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end(e instanceof Error ? e.message : String(e))
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }
  origin = `http://127.0.0.1:${addr.port}`

  return {
    origin,
    mcpUrl: `${origin}/mcp`,
    close: async () => {
      for (const s of sessions.values()) {
        await s.transport.close().catch(() => {})
      }
      server.closeAllConnections?.()
      await new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()))
      })
    },
  }
}

/** Start connectMcpServer, capture the browser URL, then simulate the redirect. */
async function connectWithOAuth(id: string, nextAuthUrl: () => Promise<string>) {
  const connectPromise = connectMcpServer(id)
  const authUrl = await nextAuthUrl()
  const state = new URL(authUrl).searchParams.get('state')
  const code = `test-code-${randomUUID()}`
  const cb = await fetch(`http://127.0.0.1:17342/oauth/callback?code=${code}&state=${state}`)
  assert(cb.status === 200, 'loopback callback returns 200')
  return connectPromise
}

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — MCP client smoke ===\n')

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-mcp-'))
  setMcpUserDataDir(tmpDir)
  const { nextAuthUrl } = mockElectronShell()

  // --- add / list ---
  console.log('Add / list servers')
  const mock = await startMockServer()
  try {
    addMcpServer({ name: '', url: mock.mcpUrl })
    assert(false, 'empty name is rejected')
  } catch {
    assert(true, 'empty name is rejected')
  }
  try {
    addMcpServer({ name: 'X', url: 'not-a-url' })
    assert(false, 'invalid URL is rejected')
  } catch {
    assert(true, 'invalid URL is rejected')
  }
  try {
    addMcpServer({ name: 'X', url: 'ftp://example.com/mcp' })
    assert(false, 'non-http(s) URL is rejected')
  } catch {
    assert(true, 'non-http(s) URL is rejected')
  }
  const added = addMcpServer({ name: 'Mock', url: mock.mcpUrl })
  assert(added.id.startsWith('mcp_'), 'add returns a generated id')
  const duplicate = addMcpServer({ name: 'Mock again', url: mock.mcpUrl })
  assert(duplicate.id === added.id, 'adding the same URL returns the existing server')
  assert(listMcpServers().some((s) => s.id === added.id), 'server appears in listMcpServers')

  // --- connect (full OAuth flow, driven by the SDK's authProvider) ---
  console.log('Connect (OAuth)')
  const connected = await connectWithOAuth(added.id, nextAuthUrl)
  assert(connected.server.status === 'connected', 'connect sets status connected')
  assert(connected.tools.length === 2, 'connect lists 2 tools')
  assert(mockState.openExternalCount === 1, 'opened the authorization URL once')
  assert(mockState.registrationCount === 1, 'registered the client once')
  assert(mockState.exchangeCount === 1, 'exchanged the authorization code once')

  // --- list / call tools ---
  console.log('List / call tools')
  const tools = await listMcpTools(added.id)
  assert(tools.length === 2, 'listMcpTools returns 2 tools')
  assert(tools.some((t) => t.name === 'echo'), 'echo tool is listed')
  const echoed = await callMcpTool(added.id, 'echo', { text: 'hello' })
  assert(JSON.stringify(echoed.content).includes('echo: hello'), 'echo tool returns its argument')

  // --- disconnect ---
  console.log('Disconnect')
  const disconnected = await disconnectMcpServer(added.id)
  assert(disconnected.status === 'disconnected', 'disconnect sets status disconnected')

  // --- reconnect with still-valid tokens (no re-OAuth) ---
  console.log('Reconnect (still-valid tokens)')
  const beforeOpen = mockState.openExternalCount
  const reconnected = await connectMcpServer(added.id)
  assert(reconnected.server.status === 'connected', 'reconnect succeeds')
  assert(mockState.openExternalCount === beforeOpen, 'reconnect does not re-open the browser (valid tokens)')

  // --- reconnect after expiry (refresh path) ---
  console.log('Refresh (expired tokens)')
  const refreshMock = await startMockServer()
  const refreshServer = addMcpServer({ name: 'Refresh', url: refreshMock.mcpUrl })
  await connectWithOAuth(refreshServer.id, nextAuthUrl)
  await disconnectMcpServer(refreshServer.id)
  // Simulate the access token expiring before the next connect.
  mockState.rejectAccessToken = true
  const beforeRefresh = mockState.refreshCount
  const beforeRefreshOpen = mockState.openExternalCount
  const refreshed = await connectMcpServer(refreshServer.id)
  mockState.rejectAccessToken = false
  assert(refreshed.server.status === 'connected', 'refresh + reconnect succeeds')
  assert(mockState.refreshCount > beforeRefresh, 'refresh token flow was used')
  assert(mockState.openExternalCount === beforeRefreshOpen, 'refresh did not re-open the browser')

  // --- remove ---
  console.log('Remove')
  const removed = await removeMcpServer(added.id)
  assert(removed === true, 'remove returns true')
  assert(!listMcpServers().some((s) => s.id === added.id), 'server is gone after remove')

  // --- client_secret round-trips through the servers file (#35) ---
  console.log('client_secret storage')
  const secretMock = await startMockServer({ returnClientSecret: true })
  const secretServer = addMcpServer({ name: 'Secret', url: secretMock.mcpUrl })
  await connectWithOAuth(secretServer.id, nextAuthUrl)
  await disconnectMcpServer(secretServer.id)
  const secretReconnected = await connectMcpServer(secretServer.id)
  assert(secretReconnected.server.status === 'connected', 'reconnect with stored client_secret succeeds')
  await removeMcpServer(secretServer.id)

  // --- #103: requires resource, metadata only via WWW-Authenticate, issuer with path ---
  console.log('#103 spec conformance (resource + WWW-Authenticate + issuer path)')
  const specMock = await startMockServer({
    wwwAuthenticateOnly: true,
    issuerPath: true,
    requireResource: true,
  })
  const specServer = addMcpServer({ name: 'Spec', url: specMock.mcpUrl })
  const specConnected = await connectWithOAuth(specServer.id, nextAuthUrl)
  assert(specConnected.server.status === 'connected', 'connect succeeds against a strict spec server')
  assert(
    specConnected.tools.length === 2,
    'tools listed against a strict spec server',
  )
  assert(
    mockState.resources.some((r) => r != null && r.length > 0),
    'token request included the resource indicator (RFC 8707)',
  )
  await removeMcpServer(specServer.id)

  await mock.close()
  await refreshMock.close()
  await secretMock.close()
  await specMock.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  // The loopback callback server is persistent, so exit explicitly.
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
