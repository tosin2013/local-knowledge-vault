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

/** True when the OS keychain/DPAPI/libsecret can encrypt secrets. */
export function secretEncryptionAvailable(): boolean {
  const ss = safeStorage()
  if (!ss) return false
  try {
    return ss.isEncryptionAvailable()
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
      if (ss.isEncryptionAvailable()) {
        return `${ENCRYPTED_PREFIX}${ss.encryptString(plaintext).toString('base64')}`
      }
    } catch {
      /* fall through to plaintext */
    }
  }
  return plaintext
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
