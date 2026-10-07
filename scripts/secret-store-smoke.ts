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
  getSelectedStorageBackend?: () => string
}
let mockSafeStorage: MockSafeStorage | null = null
let throwOnElectron = false
let mockAppVersion: string | null = null

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    if (throwOnElectron) throw new Error('no electron here')
    return { safeStorage: mockSafeStorage, app: mockAppVersion ? { getVersion: () => mockAppVersion } : undefined }
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

  // isEncryptionAvailable throw → treated as unavailable
  mockSafeStorage = {
    isEncryptionAvailable: () => {
      throw new Error('keyring unavailable')
    },
    encryptString: (s: string) => Buffer.from(`enc(${s})`),
    decryptString: (b: Buffer) => b.toString().replace(/^enc\(|\)$/g, ''),
  }
  assert(ss.secretEncryptionAvailable() === false, 'isEncryptionAvailable throw → false')

  // encryptString throw → falls through to plaintext
  mockSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: () => {
      throw new Error('encrypt failed')
    },
    decryptString: (b: Buffer) => b.toString().replace(/^enc\(|\)$/g, ''),
  }
  assert(ss.encryptSecret('sk-x') === 'sk-x', 'encryptString throw → plaintext fallback')

  // require('electron') throw → treated as unavailable / plaintext
  throwOnElectron = true
  assert(ss.secretEncryptionAvailable() === false, 'electron require throw → unavailable')
  assert(ss.encryptSecret('sk-y') === 'sk-y', 'electron require throw → plaintext')
  assert(ss.decryptSecret('enc:v1:abcd') === null, 'electron require throw → encrypted undecryptable')
  throwOnElectron = false

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

  // --- 4) Integration: bridge token (legacy read, then encrypted write) ---
  console.log('bridge token encryption (bridge-server)')
  // A pre-existing plaintext token is read transparently and cached.
  fs.writeFileSync(path.join(dir, 'lkv-bridge-token'), 'legacy-bridge-token')
  const { getBridgeToken, rotateBridgeToken, bridgeVersion } = require('../electron/bridge-server')

  // Bridge version (#42): the app's version, or 'dev' when Electron's app isn't available.
  mockAppVersion = '1.2.3'
  assert(bridgeVersion() === '1.2.3', 'bridge reports app.getVersion()')
  mockAppVersion = null
  assert(bridgeVersion() === 'dev', "bridge reports 'dev' without an Electron app")
  throwOnElectron = true
  assert(bridgeVersion() === 'dev', "bridge reports 'dev' when electron cannot be loaded")
  throwOnElectron = false

  assert(getBridgeToken() === 'legacy-bridge-token', 'legacy plaintext bridge token read')

  const token = rotateBridgeToken()
  const tokenPath = path.join(dir, 'lkv-bridge-token')
  const tokenOnDisk = fs.readFileSync(tokenPath, 'utf8')
  assert(tokenOnDisk.startsWith(ss.ENCRYPTED_PREFIX), 'bridge token written encrypted')
  assert(!tokenOnDisk.includes(token), 'bridge token not stored in plaintext')
  assert(getBridgeToken() === token, 'cached bridge token is stable')
  const rotated = rotateBridgeToken()
  assert(rotated !== token, 'rotate produces a new token')
  assert(getBridgeToken() === rotated, 'cache updated after rotate')

  // --- 5) Linux without a keyring ('basic_text') is not real encryption (#237) ---
  console.log('basic_text backend')
  mockSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc(${s})`),
    decryptString: (b: Buffer) => b.toString().replace(/^enc\(|\)$/g, ''),
    getSelectedStorageBackend: () => 'basic_text',
  } as MockSafeStorage
  assert(ss.secretEncryptionAvailable() === false, "basic_text backend is reported as not encrypted")
  assert(ss.encryptSecret('sk-z') === 'sk-z', 'basic_text backend does not pretend to encrypt')
  mockSafeStorage = { ...mockSafeStorage, getSelectedStorageBackend: () => 'gnome_libsecret' } as MockSafeStorage
  assert(ss.secretEncryptionAvailable() === true, 'a real keyring backend counts as encrypted')

  // --- 6) Startup encryption of plaintext secret files (#237) ---
  console.log('startup encryption of plaintext secret files')
  const migDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-secret-mig-'))
  setUserDataDirOverride(migDir)
  const files = require('../electron/secret-files') as {
    secretFilePaths: () => string[]
    encryptLegacySecretFiles: () => { available: boolean; encrypted: string[]; failed: string[] }
    SECRET_KEYS_DIR: string
    SECRET_BRIDGE_TOKEN_FILE: string
  }
  const { KEYS_DIR } = require('../electron/provider-store')
  assert(files.SECRET_KEYS_DIR === KEYS_DIR, 'secret-files knows the provider keys folder')
  const plainValues: Record<string, string> = {
    'lkv-groq-key': 'gsk_FAKE_groq_value',
    'lkv-xai-key': 'xai-FAKE-value',
    'lkv-bridge-token': 'FAKE-bridge-token',
    'mcp-tokens.json': '{"notion":{"access_token":"FAKE"}}',
  }
  for (const [name, value] of Object.entries(plainValues)) fs.writeFileSync(path.join(migDir, name), value + '\n')
  fs.mkdirSync(path.join(migDir, KEYS_DIR))
  fs.writeFileSync(path.join(migDir, KEYS_DIR, 'openrouter.key'), 'sk-or-FAKE')
  const alreadyEnc = ss.encryptSecret('sk-already')
  fs.writeFileSync(path.join(migDir, KEYS_DIR, 'anthropic.key'), alreadyEnc)
  fs.writeFileSync(path.join(migDir, KEYS_DIR, 'notes.txt'), 'not a key')
  const listed = files.secretFilePaths().map((p) => path.relative(migDir, p))
  assert(listed.includes('lkv-groq-key') && listed.includes('lkv-xai-key') && listed.includes('lkv-bridge-token') && listed.includes('mcp-tokens.json'), 'lists legacy keys, bridge token and MCP tokens')
  assert(listed.includes(path.join(KEYS_DIR, 'openrouter.key')) && !listed.includes(path.join(KEYS_DIR, 'notes.txt')), 'lists provider .key files only')

  // Unavailable → nothing touched.
  mockSafeStorage = null
  const none = files.encryptLegacySecretFiles()
  assert(none.available === false && none.encrypted.length === 0, 'no encryption available: nothing changes')
  assert(fs.readFileSync(path.join(migDir, 'lkv-groq-key'), 'utf8').startsWith('gsk_FAKE'), 'plaintext left as-is without encryption')

  mockSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc(${s})`),
    decryptString: (b: Buffer) => b.toString().replace(/^enc\(|\)$/g, ''),
  }
  const mig = files.encryptLegacySecretFiles()
  assert(mig.available === true && mig.failed.length === 0, 'migration runs without failures')
  assert(mig.encrypted.length === 5, `encrypts the 5 plaintext files (got ${mig.encrypted.length})`)
  assert(!mig.encrypted.includes('anthropic.key'), 'already-encrypted file is skipped')
  assert(mig.encrypted.every((n) => !Object.values(plainValues).some((v) => n.includes(v))), 'result lists file names only, never values')
  for (const [name, value] of Object.entries(plainValues)) {
    const disk = fs.readFileSync(path.join(migDir, name), 'utf8')
    assert(disk.startsWith(ss.ENCRYPTED_PREFIX) && !disk.includes(value), `${name} is encrypted on disk`)
    assert(ss.decryptSecret(disk) === value, `${name} decrypts to the original value`)
  }
  assert(readKeyFileAt(path.join(migDir, 'lkv-groq-key')) === 'gsk_FAKE_groq_value', 'migrated legacy key still reads through llm-settings')
  assert(fs.readFileSync(path.join(migDir, KEYS_DIR, 'anthropic.key'), 'utf8') === alreadyEnc, 'already-encrypted file untouched')
  assert(fs.readFileSync(path.join(migDir, KEYS_DIR, 'notes.txt'), 'utf8') === 'not a key', 'non-key file untouched')
  if (process.platform !== 'win32') {
    assert((fs.statSync(path.join(migDir, 'lkv-bridge-token')).mode & 0o777) === 0o600, 'migrated file is owner-only (0600)')
  }
  assert(!fs.readdirSync(migDir).some((f) => f.includes('.tmp-')), 'no temp files left behind')
  const again = files.encryptLegacySecretFiles()
  assert(again.encrypted.length === 0 && again.failed.length === 0, 'second run is a no-op')

  // A round-trip mismatch leaves the original untouched.
  fs.writeFileSync(path.join(migDir, KEYS_DIR, 'broken.key'), 'sk-broken-FAKE')
  mockSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc(${s})`),
    decryptString: () => 'something else',
  }
  const bad = files.encryptLegacySecretFiles()
  assert(bad.failed.includes('broken.key'), 'a failed check is reported by file name')
  assert(fs.readFileSync(path.join(migDir, KEYS_DIR, 'broken.key'), 'utf8') === 'sk-broken-FAKE', 'original kept when the decrypt check fails')
  fs.rmSync(migDir, { recursive: true, force: true })

  setUserDataDirOverride(null)
  fs.rmSync(dir, { recursive: true, force: true })

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
