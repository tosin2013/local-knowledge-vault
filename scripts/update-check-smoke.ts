/**
 * Offline smoke for the update notice (#42): version parsing/comparison, the
 * GitHub check against a stubbed fetch, the persisted setting, and the rules
 * that skip the launch check.
 *
 *   npm run test:update-check
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

process.env.LKV_USER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-update-'))

import {
  RELEASES_PAGE,
  checkForUpdate,
  checkForUpdateOnLaunch,
  compareVersions,
  getUpdateSettings,
  parseVersion,
  setUpdateSettings,
} from '../electron/update-check'

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

/** A fetch stub that records calls and answers with a canned response. */
function stubFetch(respond: () => Response | Promise<Response>): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url))
    return respond()
  }) as typeof fetch
  return { fetchImpl, calls }
}
const release = (tag: unknown, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ tag_name: tag, ...extra }), { status: 200 })

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — update check smoke ===\n')

  console.log('parseVersion / compareVersions')
  assert(JSON.stringify(parseVersion('v1.2.3')) === '[1,2,3]', 'parses a v-prefixed tag')
  assert(JSON.stringify(parseVersion(' 0.10.0 ')) === '[0,10,0]', 'parses a bare version with whitespace')
  assert(parseVersion('1.2') === null && parseVersion('v1.2.3-beta.1') === null && parseVersion('') === null, 'rejects anything that is not x.y.z')
  assert(compareVersions('0.10.0', '0.9.9') > 0, '0.10.0 is newer than 0.9.9 (numeric, not string, compare)')
  assert(compareVersions('v0.3.0', '0.3.0') === 0, 'v prefix does not matter')
  assert(compareVersions('0.2.9', '0.3.0') < 0, '0.2.9 is older than 0.3.0')
  assert(compareVersions('garbage', '0.3.0') === 0, 'an unparseable version never looks newer')

  console.log('\ncheckForUpdate')
  const newer = stubFetch(() => release('v0.4.0', { html_url: 'https://evil.example/download' }))
  const r1 = await checkForUpdate({ currentVersion: '0.3.0', fetchImpl: newer.fetchImpl })
  assert(r1.ok && r1.updateAvailable && r1.latest === '0.4.0', 'reports a newer release')
  assert(r1.ok && r1.url === `${RELEASES_PAGE}/tag/v0.4.0`, 'release URL is built from the version, not taken from the response')
  assert(newer.calls.length === 1 && newer.calls[0] === 'https://api.github.com/repos/tosin2013/local-knowledge-vault/releases/latest', 'asks the GitHub latest-release endpoint once')

  const same = await checkForUpdate({ currentVersion: '0.4.0', fetchImpl: stubFetch(() => release('v0.4.0')).fetchImpl })
  assert(same.ok && !same.updateAvailable, 'same version → no update')
  const older = await checkForUpdate({ currentVersion: '0.5.0', fetchImpl: stubFetch(() => release('v0.4.0')).fetchImpl })
  assert(older.ok && !older.updateAvailable, 'a build newer than the latest release → no update')

  const http403 = await checkForUpdate({ currentVersion: '0.3.0', fetchImpl: stubFetch(() => new Response('rate limited', { status: 403 })).fetchImpl })
  assert(!http403.ok && /403/.test(http403.error), 'HTTP error is reported, not thrown')
  const badTag = await checkForUpdate({ currentVersion: '0.3.0', fetchImpl: stubFetch(() => release('nightly/../../x')).fetchImpl })
  assert(!badTag.ok, 'a tag that is not x.y.z is rejected')
  const noTag = await checkForUpdate({ currentVersion: '0.3.0', fetchImpl: stubFetch(() => release(42)).fetchImpl })
  assert(!noTag.ok, 'a non-string tag is rejected')
  const notJson = await checkForUpdate({ currentVersion: '0.3.0', fetchImpl: stubFetch(() => new Response('<html>', { status: 200 })).fetchImpl })
  assert(!notJson.ok, 'a non-JSON body is reported, not thrown')
  const offline = await checkForUpdate({
    currentVersion: '0.3.0',
    fetchImpl: (async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com')
    }) as typeof fetch,
  })
  assert(!offline.ok && /ENOTFOUND/.test(offline.error), 'a network failure is reported, not thrown')
  const hang = await checkForUpdate({
    currentVersion: '0.3.0',
    timeoutMs: 30,
    fetchImpl: ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted')
          e.name = 'AbortError'
          reject(e)
        })
      })) as typeof fetch,
  })
  assert(!hang.ok && /Timed out/.test(hang.error), 'a hung request times out')
  const nonError = await checkForUpdate({
    currentVersion: '0.3.0',
    fetchImpl: (async () => {
      throw 'socket closed' // eslint-disable-line no-throw-literal
    }) as typeof fetch,
  })
  assert(!nonError.ok && nonError.error === 'socket closed', 'a non-Error rejection is reported as text')
  const emptyBody = await checkForUpdate({ currentVersion: '0.3.0', fetchImpl: stubFetch(() => new Response('null', { status: 200 })).fetchImpl })
  assert(!emptyBody.ok, 'a null JSON body is rejected')

  console.log('\nsettings')
  assert(getUpdateSettings().checkOnLaunch === true, 'launch check is on by default')
  assert(setUpdateSettings({ checkOnLaunch: false }).checkOnLaunch === false, 'setting can be turned off')
  assert(getUpdateSettings().checkOnLaunch === false, 'setting persists')
  assert(setUpdateSettings({}).checkOnLaunch === false, 'an empty patch keeps the saved value')
  fs.writeFileSync(path.join(process.env.LKV_USER_DATA_DIR!, 'lkv-update-settings.json'), 'not json')
  assert(getUpdateSettings().checkOnLaunch === true, 'a corrupt settings file falls back to the default')

  console.log('\ncheckForUpdateOnLaunch')
  const base = { currentVersion: '0.3.0', isPackaged: true, isSnap: false }
  setUpdateSettings({ checkOnLaunch: false })
  const off = stubFetch(() => release('v0.4.0'))
  const rOff = await checkForUpdateOnLaunch({ ...base, fetchImpl: off.fetchImpl })
  assert(rOff.ok && rOff.skipped === 'disabled' && off.calls.length === 0, 'turned off → no request is made')
  setUpdateSettings({ checkOnLaunch: true })
  const dev = stubFetch(() => release('v0.4.0'))
  const rDev = await checkForUpdateOnLaunch({ ...base, isPackaged: false, fetchImpl: dev.fetchImpl })
  assert(rDev.ok && rDev.skipped === 'development' && dev.calls.length === 0, 'development build → no request is made')
  const snap = stubFetch(() => release('v0.4.0'))
  const rSnap = await checkForUpdateOnLaunch({ ...base, isSnap: true, fetchImpl: snap.fetchImpl })
  assert(rSnap.ok && rSnap.skipped === 'snap' && snap.calls.length === 0, 'snap → no request is made (the Snap Store updates it)')
  const live = stubFetch(() => release('v0.4.0'))
  const rLive = await checkForUpdateOnLaunch({ ...base, fetchImpl: live.fetchImpl })
  assert(rLive.ok && rLive.updateAvailable && live.calls.length === 1, 'packaged build with the setting on → checks')

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
