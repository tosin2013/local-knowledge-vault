/**
 * Offline smoke for secret-store + encrypted key/token storage (#35).
 *
 * Under Node-as-Electron, `require('electron')` has no `safeStorage`, so the
 * code would only ever exercise the plaintext fallback. This test mocks
 * `safeStorage` via a Module._load hook so the encryption path is covered too.
 *
 *   npm run test:secret-store
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module') as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown
}
const origLoad = Module._load

type MockSafeStorage = {
  isEncryptionAvailable: () => boolean
  encryptString: (s: string) => Buffer
  decryptString: (b: Buffer) => string
}
let mockSafeStorage: MockSafeStorage | null = null

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return { safeStorage: mockSafeStorage }
  }
  return origLoad.call(this, request, parent, isMain)
}

import fs from 'fs'
import os from 'os'
import path from 'path'

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

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — secret-store smoke ===\n')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-secret-'))
  const { setUserDataDirOverride } = require('../electron/user-data')
  setUserDataDirOverride(dir)

  const ss = require('../electron/secret-store') as {
    secretEncryptionAvailable: () => boolean
    encryptSecret: (s: string) => string
    decryptSecret: (s: string) => string | null
    ENCRYPTED_PREFIX: string
  }

  // --- 1) No safeStorage → plaintext fallback ---
  console.log('plaintext fallback')
  mockSafeStorage = null
  assert(ss.secretEncryptionAvailable() === false, 'encryption unavailable without safeStorage')
  assert(ss.encryptSecret('sk-test') === 'sk-test', 'plaintext fallback stores as-is')
  assert(ss.decryptSecret('sk-test') === 'sk-test', 'plaintext fallback decrypts as-is')
  assert(ss.decryptSecret('  legacy-key  ') === 'legacy-key', 'legacy plaintext trimmed')
  assert(ss.decryptSecret('') === null, 'empty value decrypts to null')

  // --- 2) Mocked safeStorage → encrypted path ---
  console.log('encrypted round-trip')
  mockSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc(${s})`),
    decryptString: (b: Buffer) => b.toString().replace(/^enc\(|\)$/g, ''),
  }
  assert(ss.secretEncryptionAvailable() === true, 'encryption available with mock')
  const enc = ss.encryptSecret('sk-secret')
  assert(enc.startsWith(ss.ENCRYPTED_PREFIX), 'encrypted value is prefixed')
  assert(!enc.includes('sk-secret'), 'encrypted value hides the plaintext')
  assert(ss.decryptSecret(enc) === 'sk-secret', 'encrypted value round-trips')
  assert(ss.decryptSecret('plain-legacy') === 'plain-legacy', 'legacy plaintext still readable')

  // decryptSecret catch: a corrupt/undecryptable payload returns null
  const corrupt = ss.encryptSecret('x')
  mockSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc(${s})`),
    decryptString: () => {
      throw new Error('decrypt failed')
    },
  }
  assert(ss.decryptSecret(corrupt) === null, 'decrypt failure returns null (not throw)')

  // --- 3) Integration: API keys are written encrypted ---
  console.log('API key encryption (llm-settings)')
  mockSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc(${s})`),
    decryptString: (b: Buffer) => b.toString().replace(/^enc\(|\)$/g, ''),
  }
  const { writeKeyFileAt, readKeyFileAt } = require('../electron/llm-settings')
  const keyPath = path.join(dir, 'test.key')
  writeKeyFileAt(keyPath, 'sk-integration')
  const onDisk = fs.readFileSync(keyPath, 'utf8')
  assert(onDisk.startsWith(ss.ENCRYPTED_PREFIX), 'key file written encrypted')
  assert(!onDisk.includes('sk-integration'), 'key not stored in plaintext')
  assert(readKeyFileAt(keyPath) === 'sk-integration', 'encrypted key reads back')
  writeKeyFileAt(keyPath, null)
  assert(!fs.existsSync(keyPath), 'clearing removes the key file')

  // --- 4) Integration: bridge token is written encrypted ---
  console.log('bridge token encryption (bridge-server)')
  const { getBridgeToken, rotateBridgeToken } = require('../electron/bridge-server')
  const token = getBridgeToken()
  const tokenPath = path.join(dir, 'lkv-bridge-token')
  const tokenOnDisk = fs.readFileSync(tokenPath, 'utf8')
  assert(tokenOnDisk.startsWith(ss.ENCRYPTED_PREFIX), 'bridge token written encrypted')
  assert(!tokenOnDisk.includes(token), 'bridge token not stored in plaintext')
  assert(getBridgeToken() === token, 'cached bridge token is stable')
  const rotated = rotateBridgeToken()
  assert(rotated !== token, 'rotate produces a new token')
  assert(getBridgeToken() === rotated, 'cache updated after rotate')

  setUserDataDirOverride(null)
  fs.rmSync(dir, { recursive: true, force: true })

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
