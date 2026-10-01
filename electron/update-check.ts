/**
 * Update notice (#42). Asks GitHub for the latest release and reports whether it
 * is newer than the running app. It never downloads or installs anything: the
 * macOS builds are ad-hoc signed, so in-place updates are not possible there, and
 * a notice with a download link works the same on every platform.
 *
 * The only network call is a plain GET to the GitHub releases API. It carries no
 * identifier and no note data, and the user can turn the launch check off.
 */
import fs from 'fs'
import path from 'path'
import { resolveUserDataDir } from './user-data'
import type { UpdateCheckResult, UpdateSettings } from './types'

export const RELEASES_REPO = 'tosin2013/local-knowledge-vault'
export const RELEASES_PAGE = `https://github.com/${RELEASES_REPO}/releases`
const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`
const SETTINGS_FILE = 'lkv-update-settings.json'
const DEFAULT_SETTINGS: UpdateSettings = { checkOnLaunch: true }
/** Only plain x.y.z tags are accepted, so a tag can't smuggle anything into the release URL. */
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/

/** Parse "v1.2.3" / "1.2.3" into numbers, or null when it isn't a plain release version. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = VERSION_RE.exec((v ?? '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** <0 when a is older than b, 0 when equal, >0 when newer. Unparseable versions compare as equal. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

function settingsPath(): string {
  return path.join(resolveUserDataDir(), SETTINGS_FILE)
}

export function getUpdateSettings(): UpdateSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as Partial<UpdateSettings>
    return { checkOnLaunch: raw?.checkOnLaunch !== false }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function setUpdateSettings(patch: Partial<UpdateSettings>): UpdateSettings {
  const next: UpdateSettings = { checkOnLaunch: (patch?.checkOnLaunch ?? getUpdateSettings().checkOnLaunch) !== false }
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

export interface CheckForUpdateOptions {
  currentVersion: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** Ask GitHub for the latest release and compare it with the running version. Never throws. */
export async function checkForUpdate(opts: CheckForUpdateOptions): Promise<UpdateCheckResult> {
  const current = opts.currentVersion
  const doFetch = opts.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000)
  try {
    const res = await doFetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Vault-update-check' },
      signal: controller.signal,
    })
    if (!res.ok) return { ok: false, current, error: `GitHub answered ${res.status}` }
    const body = (await res.json()) as { tag_name?: unknown }
    const tag = typeof body?.tag_name === 'string' ? body.tag_name.trim() : ''
    const parsed = parseVersion(tag)
    if (!parsed) return { ok: false, current, error: 'Could not read the latest version from GitHub' }
    const latest = parsed.join('.')
    return {
      ok: true,
      current,
      latest,
      updateAvailable: compareVersions(latest, current) > 0,
      // Built from the validated version, never taken from the response.
      url: `${RELEASES_PAGE}/tag/v${latest}`,
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    return { ok: false, current, error: aborted ? 'Timed out reaching GitHub' : err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The check the renderer runs once at startup. Skipped when the user turned it
 * off, in development builds, and in the snap (the Snap Store updates it).
 */
export async function checkForUpdateOnLaunch(env: {
  currentVersion: string
  isPackaged: boolean
  isSnap: boolean
  fetchImpl?: typeof fetch
}): Promise<UpdateCheckResult> {
  const current = env.currentVersion
  if (!getUpdateSettings().checkOnLaunch) return { ok: true, current, skipped: 'disabled', updateAvailable: false }
  if (!env.isPackaged) return { ok: true, current, skipped: 'development', updateAvailable: false }
  if (env.isSnap) return { ok: true, current, skipped: 'snap', updateAvailable: false }
  return checkForUpdate({ currentVersion: current, fetchImpl: env.fetchImpl })
}
