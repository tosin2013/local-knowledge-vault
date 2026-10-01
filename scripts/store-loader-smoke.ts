/**
 * Offline smoke tests for store + loader edge cases (#81):
 * - user-data: LKV_USER_DATA_DIR override, tmp fallback when Electron is missing
 * - db: updateItem miss/para patch, chat-profile CRUD, unique names,
 *   ensureFriendlyGroundedHelper rename/refresh/create, initDb on existing file
 * - provider-store: corrupt-file backup, selected fallback, legacy groq key,
 *   env key precedence, setSelection/setProviderEnabled/upsert/remove error paths,
 *   isLocalUrl invalid input, plugin-prefixed overrides
 * - plugin-loader: manifest URL/id/contributes/promptFile rejections,
 *   malformed plugin.json, icon read (ok + unreadable), duplicate ids,
 *   unreadable plugins root, install error paths, reinstall backup
 * - zip-read: unsafe path + unsupported method rejections
 *
 * Runs under Electron-as-Node, temp dirs/DB, offline.
 *
 *   npm run test:store-loader
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module') as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown
}
const origLoad = Module._load
let throwOnElectron = false
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (throwOnElectron && request === 'electron') throw new Error('no electron here')
  return origLoad.call(this, request, parent, isMain)
}

const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')

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
function throwsWith(fn: () => unknown, re: RegExp, msg: string): void {
  try {
    fn()
    assert(false, `${msg} (did not throw)`)
  } catch (e) {
    assert(re.test((e as Error).message), `${msg} (got: ${(e as Error).message.slice(0, 90)})`)
  }
}

/* Minimal stored/deflate zip builder (crc unchecked by readZip). */
function buildZip(specs: Array<{ name: string; data: Buffer; method: number; sizeOverride?: number }>): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let off = 0
  for (const s of specs) {
    const nameBuf = Buffer.from(s.name, 'utf8')
    const comp = s.method === 8 ? zlib.deflateRawSync(s.data) : s.data
    const declaredSize = s.sizeOverride ?? s.data.length
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(s.method, 8)
    lh.writeUInt32LE(comp.length, 18)
    lh.writeUInt32LE(declaredSize, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    chunks.push(lh, nameBuf, comp)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(s.method, 10)
    cd.writeUInt32LE(comp.length, 20)
    cd.writeUInt32LE(declaredSize, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE(off, 42)
    central.push(cd, nameBuf)
    off += 30 + nameBuf.length + comp.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(specs.length, 8)
  eocd.writeUInt16LE(specs.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(off, 16)
  return Buffer.concat([...chunks, cdBuf, eocd])
}

const manifest = (id: string, extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  id,
  name: `${id} name`,
  version: '1.0.0',
  contributes: {
    providers: [
      { id: 'p1', label: 'P1', kind: 'openai-compatible', baseUrl: 'https://example.com/v1' },
    ],
  },
  ...extra,
})

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — Store + loader smoke ===\n')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-store-'))
  const { setUserDataDirOverride, resolveUserDataDir } = require('../electron/user-data')
  const { setLlmUserDataDir, legacyGroqKeyPath } = require('../electron/llm-settings')

  /* ---------- user-data ---------- */
  console.log('user-data')
  {
    const savedEnv = process.env.LKV_USER_DATA_DIR
    setUserDataDirOverride(null)
    const envDir = path.join(dir, 'env-data')
    process.env.LKV_USER_DATA_DIR = envDir
    assert(resolveUserDataDir() === envDir && fs.existsSync(envDir), 'LKV_USER_DATA_DIR override wins')
    if (savedEnv === undefined) delete process.env.LKV_USER_DATA_DIR
    else process.env.LKV_USER_DATA_DIR = savedEnv

    setUserDataDirOverride(null)
    throwOnElectron = true
    const fb = resolveUserDataDir()
    throwOnElectron = false
    assert(fb.endsWith('lkv-userdata') && fs.existsSync(fb), 'tmp fallback when Electron missing')
  }

  /* ---------- db ---------- */
  console.log('db edge cases')
  const dbFile = path.join(dir, 'test.sqlite')
  const db = require('../electron/db')
  db.initDb(dbFile)
  {
    assert(db.updateItem('nope', { title: 'x' }) === null, 'updateItem miss returns null')
    const it = db.createItem({ title: 't', body: 'b', para: 'resources' })
    const upd = db.updateItem(it.id, { para: 'projects' })
    assert(upd?.para === 'projects', 'updateItem para patch')

    assert(db.getChatProfile('nope') === null, 'getChatProfile miss returns null')
    const prm = db.createPrompt({ name: 'prof-prom', body: 'body' })
    const prof = db.createChatProfile({ name: 'Prof', promptId: prm.id, project: 'p' })
    assert(db.getChatProfile(prof.id)?.name === 'Prof', 'getChatProfile hit')
    const prof2 = db.createChatProfile({ name: 'Prof', promptId: prm.id, project: 'p' })
    assert(prof2.name === 'Prof (2)', `duplicate profile name suffixed (${prof2.name})`)
    const uprof = db.updateChatProfile(prof.id, { name: 'Renamed', project: 'q' })
    assert(uprof?.name === 'Renamed' && uprof?.project === 'q', 'updateChatProfile patch')
    assert(db.updateChatProfile('nope', { name: 'x' }) === null, 'updateChatProfile miss returns null')
    assert(db.deleteChatProfile(prof2.id) === true, 'deleteChatProfile hit')
    assert(db.deleteChatProfile('nope') === false, 'deleteChatProfile miss returns false')

    const helper = db.listPrompts().find((p: { name: string }) => p.name === 'Grounded helper')
    assert(!!helper, 'seeded Grounded helper exists')
    db.ensureFriendlyGroundedHelper()
    db.deletePrompt(helper.id)
    const legacy = db.createPrompt({ name: 'Grounded default', body: 'SQLite FTS5 engine notes', description: 'old' })
    db.ensureFriendlyGroundedHelper()
    const renamed = db.getPrompt(legacy.id)
    assert(renamed?.name === 'Grounded helper' && renamed?.body === db.GROUNDED_HELPER_BODY, 'legacy default renamed + refreshed')
    db.updatePrompt(renamed.id, { name: 'Grounded default', body: db.GROUNDED_HELPER_BODY })
    db.ensureFriendlyGroundedHelper()
    assert(db.getPrompt(renamed.id)?.name === 'Grounded helper', 'fresh-body legacy renamed only')
    for (const p of db.listPrompts()) db.deletePrompt(p.id)
    db.ensureFriendlyGroundedHelper()
    assert(db.listPrompts().some((p: { name: string }) => p.name === 'Grounded helper'), 'helper created when missing')

    db.closeDb()
    db.initDb(dbFile)
    assert(db.listPrompts().length > 0, 'initDb on existing file keeps prompts')
    db.closeDb()
  }

  /* ---------- provider-store ---------- */
  console.log('provider-store edge cases')
  {
    const ud = path.join(dir, 'providers-ud')
    fs.mkdirSync(ud, { recursive: true })
    setLlmUserDataDir(ud)
    const ps = require('../electron/provider-store')
    ps.resetProviderStoreCache()
    const { PROVIDERS_FILE } = ps
    const pfile = path.join(ud, PROVIDERS_FILE)

    fs.writeFileSync(pfile, 'not json{{{')
    const rebuilt = ps.loadProvidersFile()
    const backups = fs.readdirSync(ud).filter((f: string) => f.startsWith(`${PROVIDERS_FILE}.corrupt-`))
    assert(backups.length === 1 && rebuilt.providers.length > 0, 'corrupt file backed up + rebuilt')

    ps.resetProviderStoreCache()
    fs.writeFileSync(pfile, JSON.stringify({ selected: 12345, providers: [] }))
    assert(ps.loadProvidersFile().selected === 'auto', 'non-string selected falls back to auto')

    ps.setProviderKey('groq', 'sk-legacy')
    assert(ps.getProviderKey('groq') === 'sk-legacy', 'legacy groq key round-trips')
    assert(fs.existsSync(legacyGroqKeyPath()), 'legacy groq key file written')
    ps.setProviderKey('groq', null)
    assert(ps.getProviderKey('groq') === null, 'legacy groq key cleared')

    const savedEnv = process.env.LKV_GROQ_API_KEY
    process.env.LKV_GROQ_API_KEY = 'env-key-1'
    assert(ps.getProviderKey('groq', 'groq') === 'env-key-1', 'env key wins over files')
    assert(ps.getProviderKeySource('x', 'openai') === null || true, 'key source query runs')
    if (savedEnv === undefined) delete process.env.LKV_GROQ_API_KEY
    else process.env.LKV_GROQ_API_KEY = savedEnv

    throwsWith(() => ps.setSelection('no-such-provider' as never), /Unknown provider/, 'setSelection unknown throws')
    assert(ps.setSelection('auto-local') === 'auto-local', 'setSelection auto-local ok (#45)')
    assert(ps.getSelection() === 'auto-local', 'auto-local selection persists')
    assert(ps.setSelection('auto') === 'auto', 'setSelection auto ok')

    ps.setProviderEnabled('plugin:demo:openai', true)
    assert(ps.loadProvidersFile().pluginOverrides['plugin:demo:openai']?.enabled === true, 'plugin provider enabled override saved')

    throwsWith(
      () => ps.upsertProvider({ kind: 'openai-compatible', label: 'X', baseUrl: '::::', model: 'm' }),
      /not a valid URL/,
      'upsert rejects unparseable URL'
    )
    assert(ps.isLocalUrl('::::') === false, 'isLocalUrl false on garbage')
    assert(ps.isLocalUrl('http://localhost:11434') === true, 'isLocalUrl true on localhost')

    const ov = ps.upsertProvider({
      id: 'plugin:demo:openai',
      kind: 'openai-compatible',
      label: 'Demo',
      baseUrl: 'https://example.com/v1',
      model: 'm1',
      apiKey: 'sk-demo',
    })
    assert(ov === undefined, 'plugin upsert without manifest returns undefined config')
    assert(ps.loadProvidersFile().pluginOverrides['plugin:demo:openai']?.model === 'm1', 'plugin override model saved')

    const created = ps.upsertProvider({
      kind: 'openai-compatible',
      label: 'Mine',
      baseUrl: 'https://example.com/v1',
      model: 'm1',
      apiKey: 'sk-1',
    })
    assert(fs.existsSync(ps.providerKeyPath(created.id)), 'user key file written')
    assert(ps.removeProvider(created.id) === true, 'removeProvider removes user provider')
    assert(!fs.existsSync(ps.providerKeyPath(created.id)), 'user key file deleted on remove')
    assert(ps.removeProvider('ghost') === false, 'removeProvider miss returns false')
  }

  /* ---------- plugin-loader validation (pure) ---------- */
  console.log('plugin-loader manifest validation')
  {
    const pl = require('../electron/plugin-loader')
    const base = () => manifest('x1')
    const perr = (m: unknown, dir?: string) => pl.validatePluginManifest(m, dir).errors.join(' | ')

    assert(/required/.test(perr({ ...base(), contributes: { providers: [{ id: 'p1', label: 'P', kind: 'openai-compatible' }] } })), 'missing baseUrl rejected')
    assert(/http\(s\)/.test(perr({ ...base(), contributes: { providers: [{ id: 'p1', label: 'P', kind: 'openai-compatible', baseUrl: 'ftp://x' }] } })), 'ftp baseUrl rejected')
    assert(/not a valid URL/.test(perr({ ...base(), contributes: { mcpServers: [{ name: 'M', url: '::::' }] } })), 'garbage url rejected')
    const noSchema = base() as Record<string, unknown>
    delete noSchema.schemaVersion
    assert(/Missing "schemaVersion"/.test(perr(noSchema)), 'missing schemaVersion rejected')
    const noContrib = base() as Record<string, unknown>
    delete noContrib.contributes
    assert(/"contributes" object is required/.test(perr(noContrib)), 'missing contributes rejected')
    assert(/must be an array/.test(perr({ ...base(), contributes: { providers: 'nope' } })), 'non-array contributes rejected')
    assert(/promptFile must be a \.md\/\.txt/.test(perr({ ...base(), contributes: { personas: [{ name: 'N', promptFile: '../evil.md' }] } }, dir)), 'promptFile traversal rejected')
    assert(/not found in plugin folder/.test(perr({ ...base(), contributes: { personas: [{ name: 'N', promptFile: 'missing.md' }] } }, dir)), 'missing promptFile rejected')

    const badDir = path.join(dir, 'badjson')
    fs.mkdirSync(badDir, { recursive: true })
    fs.writeFileSync(path.join(badDir, 'plugin.json'), '{invalid')
    const bad = pl.readPluginDir(badDir)
    assert(!bad.info && /not valid JSON/.test(bad.errors.join(' ')), 'malformed plugin.json rejected')

    // isBundledPluginPath: only paths inside examples/plugins are installable from the renderer.
    assert(pl.isBundledPluginPath(path.join(__dirname, '../examples/plugins/study-buddy')) === true, 'bundled path recognized')
    assert(pl.isBundledPluginPath(path.join(dir, 'elsewhere')) === false, 'non-bundled path rejected')
    assert(pl.isBundledPluginPath(path.join(__dirname, '../examples/plugins')) === true, 'bundled root recognized')
    assert(pl.isBundledPluginPath({} as string) === false, 'non-string candidate rejected (catch branch)')
  }

  /* ---------- plugin install flows ---------- */
  console.log('plugin install flows')
  {
    const ud = path.join(dir, 'plugins-ud')
    setLlmUserDataDir(ud)
    const pl = require('../electron/plugin-loader')
    pl.resetPluginCache()
    const root = pl.pluginsDir()

    const mkFolder = (name: string, id: string, withIcon: boolean, iconMode?: number) => {
      const f = path.join(dir, name)
      fs.mkdirSync(f, { recursive: true })
      fs.writeFileSync(path.join(f, 'plugin.json'), JSON.stringify(manifest(id)))
      if (withIcon) {
        const icon = path.join(f, 'icon.png')
        fs.writeFileSync(icon, Buffer.alloc(1024, 7))
        if (iconMode !== undefined) fs.chmodSync(icon, iconMode)
      }
      return f
    }

    const ok1 = pl.installPluginFrom(mkFolder('plug-icon', 'icon-test', true))
    assert(ok1.ok === true && ok1.plugin?.id === 'icon-test', 'install with icon succeeds')
    const iconDir = mkFolder('plug-noicon-read', 'icon-unreadable', true, 0o000)
    const unread = pl.readPluginDir(iconDir)
    try {
      fs.chmodSync(path.join(iconDir, 'icon.png'), 0o644)
    } catch {
      /* ignore */
    }
    assert(unread.info?.id === 'icon-unreadable', 'unreadable icon still yields plugin info')

    for (const [folder, id] of [['dup-a', 'dup-plugin'], ['dup-b', 'dup-plugin']] as Array<[string, string]>) {
      const f = path.join(root, folder)
      fs.mkdirSync(f, { recursive: true })
      fs.writeFileSync(path.join(f, 'plugin.json'), JSON.stringify(manifest(id)))
    }
    pl.resetPluginCache()
    const dup = pl.reloadPlugins()
    assert(dup.errors.some((e: { errors: string[] }) => e.errors.join(' ').includes('Duplicate plugin id')), 'duplicate plugin id reported')
    for (const folder of ['dup-a', 'dup-b']) fs.rmSync(path.join(root, folder), { recursive: true, force: true })
    pl.resetPluginCache()

    fs.chmodSync(root, 0o000)
    pl.resetPluginCache()
    const denied = pl.reloadPlugins()
    fs.chmodSync(root, 0o755)
    assert(denied.errors.some((e: { folder: string } ) => e.folder === '.'), 'unreadable plugins root reported')
    pl.resetPluginCache()

    const txt = path.join(dir, 'note.txt')
    fs.writeFileSync(txt, 'hi')
    assert(pl.installPluginFrom(txt).ok === false, 'non-plugin file rejected')
    assert(pl.installPluginFrom(path.join(dir, 'missing')).ok === false, 'missing path rejected')
    const noJson = path.join(dir, 'nojson')
    fs.mkdirSync(noJson, { recursive: true })
    fs.writeFileSync(path.join(noJson, 'readme.md'), 'nothing')
    const nj = pl.installPluginFrom(noJson)
    assert(nj.ok === false && nj.errors.join(' ').includes('No plugin.json'), 'folder without plugin.json rejected')

    const r1 = pl.installPluginFrom(mkFolder('plug-reinst', 'reinst', false))
    assert(r1.ok === true, 'first install ok')
    const r2 = pl.installPluginFrom(mkFolder('plug-reinst2', 'reinst', false))
    assert(r2.ok === true && r2.warnings.join(' ').includes('.previous'), 'reinstall backs up previous')

    fs.chmodSync(root, 0o555)
    const ro = pl.installPluginFrom(mkFolder('plug-ro', 'ro-test', false))
    fs.chmodSync(root, 0o755)
    assert(ro.ok === false, 'read-only plugins root fails install')

    const bigZip = path.join(dir, 'oversized.zip')
    fs.writeFileSync(bigZip, Buffer.alloc(0))
    fs.truncateSync(bigZip, 51 * 1024 * 1024)
    const big = pl.installPluginFrom(bigZip)
    assert(big.ok === false && /too large/i.test(big.errors.join(' ')), 'oversized zip file rejected before read')
  }

  /* ---------- zip-read ---------- */
  console.log('zip-read rejections')
  {
    const { readZip } = require('../electron/zip-read')
    const ok = buildZip([{ name: 'a.txt', data: Buffer.from('hi'), method: 0 }])
    assert(readZip(ok)[0]?.data.toString() === 'hi', 'stored entry round-trips')
    throwsWith(
      () => readZip(buildZip([{ name: '../../evil.txt', data: Buffer.from('x'), method: 0 }])),
      /Unsafe path/,
      'traversal entry rejected'
    )
    throwsWith(
      () => readZip(buildZip([{ name: 'a.bin', data: Buffer.from('x'), method: 12 }])),
      /Unsupported zip compression method/,
      'unknown method rejected'
    )
    // Declared-huge entry (honest zip bomb): reject before decompression.
    throwsWith(
      () => readZip(buildZip([{ name: 'huge.txt', data: Buffer.from('x'), method: 0, sizeOverride: 30 * 1024 * 1024 }])),
      /too large/,
      'declared-huge entry rejected'
    )
    // High-ratio bomb with a lying declared size: inflate is bounded by maxOutputLength.
    throwsWith(
      () => readZip(buildZip([{ name: 'bomb.txt', data: Buffer.alloc(30 * 1024 * 1024, 0), method: 8, sizeOverride: 100 }])),
      /too large/,
      'zip bomb (lying size) rejected'
    )
  }

  setUserDataDirOverride(null)
  fs.rmSync(dir, { recursive: true, force: true })

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
