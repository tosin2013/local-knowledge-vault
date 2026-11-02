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
/**
 * Semver x.y.z with an optional pre-release ("-rc.4"); build metadata ("+abc") is ignored.
 * Identifiers are limited to [0-9A-Za-z-], so a tag can't smuggle anything into the release URL.
 */
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export interface ParsedVersion {
  core: [number, number, number]
  /** Pre-release identifiers, e.g. ['rc', '4']; empty for a release. */
  pre: string[]
}

/** Parse "v1.2.3" / "1.2.3-rc.4", or null when it isn't a semver version. */
export function parseVersion(v: string): ParsedVersion | null {
  const m = VERSION_RE.exec((v ?? '').trim())
  if (!m) return null
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] }
}

/** Canonical text for a parsed version ("1.2.3" or "1.2.3-rc.4"). */
export function formatVersion(p: ParsedVersion): string {
  return p.core.join('.') + (p.pre.length ? `-${p.pre.join('.')}` : '')
}

const NUMERIC = /^\d+$/

/** Semver precedence of one pre-release identifier pair. */
function compareIdentifier(a: string, b: string): number {
  const an = NUMERIC.test(a)
  const bn = NUMERIC.test(b)
  if (an && bn) return Number(a) - Number(b)
  if (an) return -1
  if (bn) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Semver precedence: <0 when a is older than b, 0 when equal, >0 when newer.
 * A release outranks its own pre-releases (0.6.0 > 0.6.0-rc.4). Unparseable versions compare as equal.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i]
  }
  if (!pa.pre.length || !pb.pre.length) return pb.pre.length - pa.pre.length
  const n = Math.min(pa.pre.length, pb.pre.length)
  for (let i = 0; i < n; i++) {
    const c = compareIdentifier(pa.pre[i], pb.pre[i])
    if (c !== 0) return c
  }
  return pa.pre.length - pb.pre.length
}

/** True inside a snap, where the Snap Store handles updates. */
export function isSnapEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.SNAP
}

function settingsPath(): string {
  return path.join(resolveUserDataDir(), SETTINGS_FILE)
}

export function getUpdateSettings(): UpdateSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as Partial<UpdateSettings>
    return { checkOnLaunch: raw?.checkOnLaunch !== false, snap: isSnapEnv() }
  } catch {
    return { ...DEFAULT_SETTINGS, snap: isSnapEnv() }
  }
}

export function setUpdateSettings(patch: Partial<UpdateSettings>): UpdateSettings {
  const next: UpdateSettings = { checkOnLaunch: (patch?.checkOnLaunch ?? getUpdateSettings().checkOnLaunch) !== false }
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
  return { ...next, snap: isSnapEnv() }
}

export interface CheckForUpdateOptions {
  currentVersion: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Defaults to the SNAP environment variable. In a snap no request is made. */
  isSnap?: boolean
}

/** Ask GitHub for the latest release and compare it with the running version. Never throws. */
export async function checkForUpdate(opts: CheckForUpdateOptions): Promise<UpdateCheckResult> {
  const current = opts.currentVersion
  if (opts.isSnap ?? isSnapEnv()) return { ok: true, current, skipped: 'snap', updateAvailable: false }
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
    const latest = formatVersion(parsed)
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
  return checkForUpdate({ currentVersion: current, fetchImpl: env.fetchImpl, isSnap: env.isSnap })
}
