/**
 * Single place to resolve Vault's userData directory for settings / keys / plugins.
 * Order: test override → LKV_USER_DATA_DIR → Electron app.getPath('userData') → tmp fallback.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

let override: string | null = null

/** Tests / scripts: point settings, keys, and plugins at a temp dir. */
export function setUserDataDirOverride(dir: string | null): void {
  override = dir
}

export function resolveUserDataDir(): string {
  if (override) return override
  const env = process.env.LKV_USER_DATA_DIR?.trim()
  if (env) {
    fs.mkdirSync(env, { recursive: true })
    return env
  }
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
