/**
 * Where Vault keeps secrets on disk, and the startup step that encrypts any still in
 * plaintext (#237). Paths only; this module never reads or logs secret values itself.
 */
import fs from 'fs'
import path from 'path'
import { resolveUserDataDir } from './user-data'
import { legacyGroqKeyPath, legacyXaiKeyPath } from './llm-settings'
import { encryptPlaintextSecretFiles, type SecretFileMigration } from './secret-store'

/** Matches provider-store KEYS_DIR, bridge-server BRIDGE_TOKEN_FILE and mcp-client TOKENS_FILE. */
export const SECRET_KEYS_DIR = 'lkv-keys'
export const SECRET_BRIDGE_TOKEN_FILE = 'lkv-bridge-token'
export const SECRET_MCP_TOKENS_FILE = 'mcp-tokens.json'

/** Every secret file that exists today: API keys, the bridge token and MCP OAuth tokens. */
export function secretFilePaths(): string[] {
  const dir = resolveUserDataDir()
  const paths = [
    legacyGroqKeyPath(),
    legacyXaiKeyPath(),
    path.join(dir, SECRET_BRIDGE_TOKEN_FILE),
    path.join(dir, SECRET_MCP_TOKENS_FILE),
  ]
  const keysDir = path.join(dir, SECRET_KEYS_DIR)
  try {
    for (const f of fs.readdirSync(keysDir)) {
      if (f.endsWith('.key')) paths.push(path.join(keysDir, f))
    }
  } catch {
    /* no keys folder yet */
  }
  return paths
}

/** Run once at startup (after app ready, so the OS keyring is reachable). */
export function encryptLegacySecretFiles(): SecretFileMigration {
  const result = encryptPlaintextSecretFiles(secretFilePaths())
  if (result.encrypted.length) {
    console.log(`[Vault secrets] encrypted ${result.encrypted.length} plaintext secret file(s)`)
  }
  if (result.failed.length) {
    console.warn(`[Vault secrets] could not encrypt: ${result.failed.join(', ')} (left unchanged)`)
  }
  return result
}
