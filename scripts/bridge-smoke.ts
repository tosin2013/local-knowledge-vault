/**
 * Offline smoke tests for the Vault Bridge security hardening.
 * Verifies bearer auth, Host allowlist, JSON-only, body cap, and no CORS.
 * Never touches the real userData dir.
 *
 *   npm run test:bridge
 */
import http from 'http'
import os from 'os'
import path from 'path'
import fs from 'fs'

import { setUserDataDirOverride } from '../electron/user-data'
import {
  startBridgeServer,
  stopBridgeServer,
  getBridgeToken,
  rotateBridgeToken,
  BRIDGE_HOST,
} from '../electron/bridge-server'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed++
    console.log(`  ✓ ${msg}`)
  } else {
    failed++
    console.log(`  ✗ ${msg}`)
  }
}

interface RawResponse {
  status: number
  headers: http.IncomingHttpHeaders
  body: string
}

function request(
  port: number,
  opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string }
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: BRIDGE_HOST,
        port,
        method: opts.method ?? 'GET',
        path: opts.path ?? '/',
        headers: opts.headers ?? {},
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: raw })
        )
      }
    )
    req.on('error', reject)
    if (opts.body != null) req.write(opts.body)
    req.end()
  })
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-bridge-smoke-'))
  setUserDataDirOverride(dir)

  const port = 20000 + Math.floor(Math.random() * 30000)
  const server = startBridgeServer(port)
  await new Promise<void>((resolve) => {
    if (server.listening) resolve()
    else server.once('listening', () => resolve())
    setTimeout(resolve, 2000)
  })

  // token generation + 0600 storage
  const token = getBridgeToken()
  assert(typeof token === 'string' && token.length >= 32, `token generated (${token.length} chars)`)
  const tokenPath = path.join(dir, 'lkv-bridge-token')
  const mode = fs.statSync(tokenPath).mode & 0o777
  assert(mode === 0o600, `token file is 0600 (got ${mode.toString(8)})`)

  // /health is open, and grants no CORS
  const health = await request(port, { path: '/health' })
  assert(health.status === 200, `GET /health → 200 (got ${health.status})`)
  assert(!('access-control-allow-origin' in health.headers), 'no Access-Control-Allow-Origin header')

  // DNS-rebinding guard: non-loopback Host rejected
  const rebind = await request(port, { path: '/health', headers: { Host: 'evil.example:8765' } })
  assert(rebind.status === 403, `non-loopback Host → 403 (got ${rebind.status})`)

  // data endpoints require the bearer token
  const noAuth = await request(port, { path: '/v1/projects' })
  assert(noAuth.status === 401, `GET /v1/projects without token → 401 (got ${noAuth.status})`)

  const wrongAuth = await request(port, {
    path: '/v1/projects',
    headers: { Authorization: 'Bearer not-the-token' },
  })
  assert(wrongAuth.status === 401, `GET /v1/projects wrong token → 401 (got ${wrongAuth.status})`)

  const askNoAuth = await request(port, {
    method: 'POST',
    path: '/v1/ask',
    headers: { 'Content-Type': 'application/json' },
    body: '{"text":"hi"}',
  })
  assert(askNoAuth.status === 401, `POST /v1/ask without token → 401 (got ${askNoAuth.status})`)

  // JSON-only: text/plain rejected even with a valid token
  const badCt = await request(port, {
    method: 'POST',
    path: '/v1/ask',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    body: '{"text":"hi"}',
  })
  assert(badCt.status === 415, `POST /v1/ask text/plain → 415 (got ${badCt.status})`)

  // body cap (~64 KB → 413)
  const big = JSON.stringify({ text: 'x'.repeat(70 * 1024) })
  const oversized = await request(port, {
    method: 'POST',
    path: '/v1/ask',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: big,
  })
  assert(oversized.status === 413, `POST /v1/ask oversized body → 413 (got ${oversized.status})`)

  // valid token passes auth (may be 200 or 400 depending on DB/LLM, but never 401/403)
  const valid = await request(port, {
    path: '/v1/projects',
    headers: { Authorization: `Bearer ${token}` },
  })
  assert(valid.status !== 401 && valid.status !== 403, `valid token passes auth (got ${valid.status})`)

  // rotation invalidates the old token
  const rotated = rotateBridgeToken()
  assert(rotated !== token && rotated.length >= 32, 'rotateBridgeToken produces a new token')
  const oldAfterRotate = await request(port, {
    path: '/v1/projects',
    headers: { Authorization: `Bearer ${token}` },
  })
  assert(oldAfterRotate.status === 401, `old token rejected after rotation → 401 (got ${oldAfterRotate.status})`)

  stopBridgeServer()
  setUserDataDirOverride(null)
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
