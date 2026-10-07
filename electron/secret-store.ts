/**
 * Secret storage backed by Electron's `safeStorage` (macOS Keychain, Windows DPAPI,
 * Linux libsecret/kwallet), with a transparent plaintext fallback for environments
 * where OS-level encryption isn't available (headless Linux, Node-as-Electron tests).
 *
 * Encrypted values are stored as `enc:v1:<base64>`. Legacy plaintext values are read
 * transparently and upgraded to the encrypted form on their next write.
 */

type SafeStorageLike = {
  isEncryptionAvailable: () => boolean
  encryptString: (plainText: string) => Buffer
  decryptString: (encrypted: Buffer) => string
  /** Linux only. 'basic_text' means no keyring: Electron "encrypts" with a fixed password. */
  getSelectedStorageBackend?: () => string
}

export const ENCRYPTED_PREFIX = 'enc:v1:'

function safeStorage(): SafeStorageLike | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { safeStorage?: SafeStorageLike }
    return electron?.safeStorage
  } catch {
    return undefined
  }
}

function usable(ss: SafeStorageLike): boolean {
  if (!ss.isEncryptionAvailable()) return false
  // On Linux without a keyring Electron falls back to a hard-coded password. That is not
  // real protection, so treat it as "no encryption" and say so in the UI (#237).
  const backend = typeof ss.getSelectedStorageBackend === 'function' ? ss.getSelectedStorageBackend() : ''
  return backend !== 'basic_text'
}

/** True when the OS keychain/DPAPI/libsecret can encrypt secrets. */
export function secretEncryptionAvailable(): boolean {
  const ss = safeStorage()
  if (!ss) return false
  try {
    return usable(ss)
  } catch {
    return false
  }
}

/** Encrypt `plaintext` (or pass it through when encryption is unavailable). */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return ''
  const ss = safeStorage()
  if (ss) {
    try {
      if (usable(ss)) {
        return `${ENCRYPTED_PREFIX}${ss.encryptString(plaintext).toString('base64')}`
      }
    } catch {
      /* fall through to plaintext */
    }
  }
  return plaintext
}

export interface SecretFileMigration {
  /** False when the OS cannot encrypt; nothing was touched. */
  available: boolean
  /** File names (never contents) that were plaintext and are now encrypted. */
  encrypted: string[]
  /** File names that could not be upgraded; they were left exactly as they were. */
  failed: string[]
}

/**
 * Encrypt secret files that are still plaintext (saved before encryption existed, or on a
 * machine without a keyring at the time) (#237). Each file is encrypted, checked by
 * decrypting it again, written to a temp file and renamed over the original, so a failure
 * at any step leaves the original untouched. Missing and already-encrypted files are skipped.
 * Returns file names only and never logs secret values.
 */
export function encryptPlaintextSecretFiles(paths: string[]): SecretFileMigration {
  const result: SecretFileMigration = { available: secretEncryptionAvailable(), encrypted: [], failed: [] }
  if (!result.available) return result
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path')
  for (const p of paths) {
    const name = path.basename(p)
    let raw: string
    try {
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue
      raw = fs.readFileSync(p, 'utf8')
    } catch {
      result.failed.push(name)
      continue
    }
    const plain = raw.trim()
    if (!plain || raw.startsWith(ENCRYPTED_PREFIX)) continue
    const tmp = `${p}.tmp-${process.pid}`
    try {
      const stored = encryptSecret(plain)
      if (!stored.startsWith(ENCRYPTED_PREFIX) || decryptSecret(stored) !== plain) {
        result.failed.push(name)
        continue
      }
      fs.writeFileSync(tmp, stored, { encoding: 'utf8', mode: 0o600 })
      fs.renameSync(tmp, p)
      try {
        fs.chmodSync(p, 0o600)
      } catch {
        /* Windows may ignore mode */
      }
      result.encrypted.push(name)
    } catch {
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
      } catch {
        /* ignore */
      }
      result.failed.push(name)
    }
  }
  return result
}

/** Decrypt a value written by `encryptSecret`; also reads legacy plaintext. */
export function decryptSecret(stored: string): string | null {
  if (!stored) return null
  if (stored.startsWith(ENCRYPTED_PREFIX)) {
    const ss = safeStorage()
    if (!ss) return null
    try {
      const buf = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64')
      const plain = ss.decryptString(buf)
      return plain || null
    } catch {
      return null
    }
  }
  return stored.trim() || null
}
