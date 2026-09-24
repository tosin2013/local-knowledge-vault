/**
 * Declarative plugins: <userData>/plugins/<plugin-id>/plugin.json (+ optional icon.png, *.md prompts).
 * NO code execution — plugins only contribute data (provider presets, grounded personas,
 * prompt packs, MCP server presets). Grounding rules are applied by Vault, never by plugins.
 */
import fs from 'fs'
import path from 'path'
import { resolveUserDataDir } from './user-data'
import { readZip } from './zip-read'
import type {
  PluginContributions,
  PluginInfo,
  PluginInstallResult,
  PluginListResult,
  PluginLoadError,
  PluginManifest,
  PluginMcpServerPreset,
  PluginPersona,
  PluginPromptPack,
  PluginProviderPreset,
} from './types'

export const PLUGIN_SCHEMA_VERSION = 1
export const PLUGINS_DIRNAME = 'plugins'
const STATE_FILE = 'lkv-plugins.json'
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
const PRESET_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/
const CONTRIBUTION_TYPES = ['providers', 'personas', 'promptPacks', 'mcpServers'] as const
const PROVIDER_KINDS = ['openai-compatible', 'anthropic', 'ollama', 'gemini'] as const
/** Files copied on install. Anything else (scripts, binaries) is skipped. */
const ASSET_EXT = new Set(['.json', '.md', '.txt', '.png', '.jpg', '.jpeg', '.webp', '.svg'])
const MAX_ITEMS = 20

let cached: { plugins: PluginInfo[]; errors: PluginLoadError[] } | null = null

export function pluginsDir(): string {
  return path.join(resolveUserDataDir(), PLUGINS_DIRNAME)
}

function statePath(): string {
  return path.join(resolveUserDataDir(), STATE_FILE)
}

function readState(): { disabled: string[] } {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as { disabled?: unknown }
    return { disabled: Array.isArray(s.disabled) ? s.disabled.filter((x): x is string => typeof x === 'string') : [] }
  } catch {
    return { disabled: [] }
  }
}

function writeState(s: { disabled: string[] }): void {
  fs.mkdirSync(resolveUserDataDir(), { recursive: true })
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), 'utf8')
}

/* ---------------- validation ---------------- */

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max = 500): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max

function isPrivateHost(h: string): boolean {
  return (
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h.endsWith('.local') ||
    h.endsWith('.lan')
  )
}

function checkUrl(
  u: unknown,
  where: string,
  errors: string[],
  opts: { httpsOnlyRemote?: boolean; allowPrivateHttp?: boolean } = {}
): u is string {
  if (!str(u, 2000)) {
    errors.push(`${where}: "url" / "baseUrl" is required`)
    return false
  }
  try {
    const url = new URL(u)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      errors.push(`${where}: URL must be http(s):// (got ${url.protocol})`)
      return false
    }
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
    const lanOk = opts.allowPrivateHttp && isPrivateHost(url.hostname)
    if (opts.httpsOnlyRemote && url.protocol === 'http:' && !local && !lanOk) {
      errors.push(`${where}: remote URLs must use https:// (plain http is only allowed for localhost${opts.allowPrivateHttp ? ' / LAN addresses' : ''})`)
      return false
    }
  } catch {
    errors.push(`${where}: not a valid URL: ${String(u)}`)
    return false
  }
  return true
}

/**
 * Validate a parsed plugin.json. `dir` (optional) lets personas reference promptFile assets.
 * Returns human-readable errors (empty = valid). Pure except for promptFile reads.
 */
export function validatePluginManifest(
  raw: unknown,
  dir?: string
): { manifest?: PluginManifest; errors: string[] } {
  const errors: string[] = []
  if (!isObj(raw)) return { errors: ['plugin.json must be a JSON object'] }

  if (raw.schemaVersion !== PLUGIN_SCHEMA_VERSION) {
    errors.push(
      raw.schemaVersion === undefined
        ? `Missing "schemaVersion" (use ${PLUGIN_SCHEMA_VERSION})`
        : `Unsupported schemaVersion ${JSON.stringify(raw.schemaVersion)} — this Vault supports ${PLUGIN_SCHEMA_VERSION}`
    )
  }
  if (!str(raw.id, 64) || !PLUGIN_ID_RE.test(raw.id)) {
    errors.push(`"id" must be 2–64 chars of lowercase letters, digits and dashes (got ${JSON.stringify(raw.id)})`)
  }
  if (!str(raw.name, 80)) errors.push('"name" is required (≤ 80 chars)')
  if (!str(raw.version, 40) || !/^\d+\.\d+\.\d+/.test(raw.version)) {
    errors.push(`"version" must look like 1.0.0 (got ${JSON.stringify(raw.version)})`)
  }
  if (raw.description !== undefined && typeof raw.description !== 'string') errors.push('"description" must be a string')
  if (raw.author !== undefined && typeof raw.author !== 'string') errors.push('"author" must be a string')
  for (const k of ['main', 'scripts', 'script', 'entry', 'code']) {
    if (k in raw) errors.push(`"${k}" is not allowed — Vault plugins are declarative (no code execution) in this version`)
  }

  const contributes: PluginManifest['contributes'] = {}
  if (!isObj(raw.contributes)) {
    errors.push('"contributes" object is required (providers, personas, promptPacks and/or mcpServers)')
  } else {
    const c = raw.contributes
    for (const k of Object.keys(c)) {
      if (!(CONTRIBUTION_TYPES as readonly string[]).includes(k)) {
        errors.push(`Unknown contribution type "${k}" (supported: ${CONTRIBUTION_TYPES.join(', ')})`)
      }
    }
    const arr = (k: string): unknown[] | null => {
      if (c[k] === undefined) return null
      if (!Array.isArray(c[k])) {
        errors.push(`contributes.${k} must be an array`)
        return null
      }
      if ((c[k] as unknown[]).length > MAX_ITEMS) errors.push(`contributes.${k}: at most ${MAX_ITEMS} entries`)
      return c[k] as unknown[]
    }

    const providers = arr('providers')
    if (providers) {
      contributes.providers = []
      const seen = new Set<string>()
      providers.forEach((p, i) => {
        const at = `contributes.providers[${i}]`
        if (!isObj(p)) return errors.push(`${at} must be an object`)
        const e0 = errors.length
        if (!str(p.id, 64) || !PRESET_ID_RE.test(p.id)) errors.push(`${at}.id must be lowercase letters/digits/._- (got ${JSON.stringify(p.id)})`)
        else if (seen.has(p.id)) errors.push(`${at}.id "${p.id}" is duplicated`)
        if (!str(p.label, 60)) errors.push(`${at}.label is required`)
        if (!(PROVIDER_KINDS as readonly string[]).includes(p.kind as string)) {
          errors.push(`${at}.kind must be one of ${PROVIDER_KINDS.join(', ')} (got ${JSON.stringify(p.kind)})`)
        }
        checkUrl(p.baseUrl, at, errors, { httpsOnlyRemote: true, allowPrivateHttp: true })
        if (p.defaultModel !== undefined && typeof p.defaultModel !== 'string') errors.push(`${at}.defaultModel must be a string`)
        if (p.local !== undefined && typeof p.local !== 'boolean') errors.push(`${at}.local must be true/false`)
        if (p.requiresKey !== undefined && typeof p.requiresKey !== 'boolean') errors.push(`${at}.requiresKey must be true/false`)
        for (const bad of ['apiKey', 'key', 'token', 'headers']) {
          if (bad in p) errors.push(`${at}.${bad} is not allowed — never ship keys or custom headers in a plugin; users add their own key`)
        }
        if (errors.length === e0) {
          seen.add(p.id as string)
          contributes.providers!.push({
            id: p.id as string,
            label: (p.label as string).trim(),
            kind: p.kind as PluginProviderPreset['kind'],
            baseUrl: (p.baseUrl as string).trim().replace(/\/+$/, ''),
            defaultModel: typeof p.defaultModel === 'string' ? p.defaultModel.trim() : '',
            local: p.local === true,
            requiresKey: p.requiresKey === undefined ? p.local !== true : p.requiresKey === true,
            docsUrl: typeof p.docsUrl === 'string' ? p.docsUrl : undefined,
            notes: typeof p.notes === 'string' ? p.notes.slice(0, 300) : undefined,
          })
        }
      })
    }

    const personas = arr('personas')
    if (personas) {
      contributes.personas = []
      personas.forEach((p, i) => {
        const at = `contributes.personas[${i}]`
        if (!isObj(p)) return errors.push(`${at} must be an object`)
        if (!str(p.name, 60)) return errors.push(`${at}.name is required (≤ 60 chars)`)
        let prompt: string | null = null
        const inline = p.prompt ?? p.vibe
        if (typeof inline === 'string' && inline.trim()) prompt = inline.trim()
        else if (typeof p.promptFile === 'string') {
          const rel = p.promptFile
          if (!/^[\w.\-/]+\.(md|txt)$/i.test(rel) || rel.split('/').includes('..')) {
            return errors.push(`${at}.promptFile must be a .md/.txt file inside the plugin folder`)
          }
          if (!dir) return errors.push(`${at}.promptFile "${rel}" can't be read before install`)
          try {
            const text = fs.readFileSync(path.join(dir, rel), 'utf8')
            if (text.length > 16_000) return errors.push(`${at}.promptFile is too large (> 16 KB)`)
            prompt = text.trim()
          } catch {
            return errors.push(`${at}.promptFile "${rel}" not found in plugin folder`)
          }
        }
        if (!prompt) return errors.push(`${at} needs "prompt" (or "vibe") text, or "promptFile"`)
        if (prompt.length > 4000) return errors.push(`${at}.prompt is too long (> 4000 chars)`)
        contributes.personas!.push({
          name: (p.name as string).trim(),
          prompt,
          description: typeof p.description === 'string' ? p.description.slice(0, 200) : undefined,
        })
      })
    }

    const packs = arr('promptPacks')
    if (packs) {
      contributes.promptPacks = []
      packs.forEach((p, i) => {
        const at = `contributes.promptPacks[${i}]`
        if (!isObj(p)) return errors.push(`${at} must be an object`)
        if (!str(p.name, 60)) return errors.push(`${at}.name is required`)
        if (!Array.isArray(p.prompts) || p.prompts.length === 0) return errors.push(`${at}.prompts must be a non-empty array of strings`)
        const prompts = (p.prompts as unknown[]).filter((q): q is string => str(q, 300)).map((q) => q.trim())
        if (prompts.length !== p.prompts.length) return errors.push(`${at}.prompts: every entry must be a non-empty string ≤ 300 chars`)
        contributes.promptPacks!.push({ name: (p.name as string).trim(), prompts: prompts.slice(0, MAX_ITEMS) })
      })
    }

    const mcp = arr('mcpServers')
    if (mcp) {
      contributes.mcpServers = []
      mcp.forEach((m, i) => {
        const at = `contributes.mcpServers[${i}]`
        if (!isObj(m)) return errors.push(`${at} must be an object`)
        if (!str(m.name, 60)) return errors.push(`${at}.name is required`)
        if (!checkUrl(m.url, at, errors, { httpsOnlyRemote: true })) return
        for (const bad of ['token', 'apiKey', 'headers', 'auth']) {
          if (bad in m) errors.push(`${at}.${bad} is not supported — Vault signs in with OAuth in the browser when the server asks`)
        }
        contributes.mcpServers!.push({
          name: (m.name as string).trim(),
          url: (m.url as string).trim(),
          description: typeof m.description === 'string' ? m.description.slice(0, 200) : undefined,
        })
      })
    }

    const total =
      (contributes.providers?.length ?? 0) +
      (contributes.personas?.length ?? 0) +
      (contributes.promptPacks?.length ?? 0) +
      (contributes.mcpServers?.length ?? 0)
    if (total === 0 && errors.length === 0) errors.push('Plugin contributes nothing (add providers, personas, promptPacks or mcpServers)')
  }

  if (errors.length) return { errors }
  return {
    errors,
    manifest: {
      schemaVersion: 1,
      id: raw.id as string,
      name: (raw.name as string).trim(),
      version: (raw.version as string).trim(),
      description: typeof raw.description === 'string' ? raw.description.trim() : undefined,
      author: typeof raw.author === 'string' ? raw.author.trim() : undefined,
      homepage: typeof raw.homepage === 'string' ? raw.homepage : undefined,
      contributes,
    },
  }
}

function parseJsonWithHint(text: string): { value?: unknown; error?: string } {
  try {
    return { value: JSON.parse(text) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const pos = /position (\d+)/.exec(msg)
    if (pos) {
      const i = Number(pos[1])
      const line = text.slice(0, i).split('\n').length
      return { error: `plugin.json is not valid JSON (line ${line}): ${msg}` }
    }
    return { error: `plugin.json is not valid JSON: ${msg}` }
  }
}

function summarize(m: PluginManifest): string[] {
  const out: string[] = []
  const n = (k: number, one: string, many: string) => (k ? out.push(`${k} ${k === 1 ? one : many}`) : 0)
  n(m.contributes.providers?.length ?? 0, 'provider preset', 'provider presets')
  n(m.contributes.personas?.length ?? 0, 'persona', 'personas')
  n(m.contributes.promptPacks?.length ?? 0, 'prompt pack', 'prompt packs')
  n(m.contributes.mcpServers?.length ?? 0, 'MCP server preset', 'MCP server presets')
  return out
}

/** Read + validate one plugin folder. */
export function readPluginDir(dir: string): { info?: PluginInfo; errors: string[] } {
  const manifestPath = path.join(dir, 'plugin.json')
  if (!fs.existsSync(manifestPath)) return { errors: ['Missing plugin.json'] }
  const parsed = parseJsonWithHint(fs.readFileSync(manifestPath, 'utf8'))
  if (parsed.error) return { errors: [parsed.error] }
  const { manifest, errors } = validatePluginManifest(parsed.value, dir)
  if (!manifest) return { errors }
  let iconDataUrl: string | undefined
  const icon = path.join(dir, 'icon.png')
  try {
    if (fs.existsSync(icon) && fs.statSync(icon).size <= 256 * 1024) {
      iconDataUrl = `data:image/png;base64,${fs.readFileSync(icon).toString('base64')}`
    }
  } catch {
    /* ignore */
  }
  const disabled = new Set(readState().disabled)
  return {
    errors: [],
    info: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description ?? '',
      author: manifest.author,
      source: 'installed',
      enabled: !disabled.has(manifest.id),
      dir,
      contributes: summarize(manifest),
      manifest,
      iconDataUrl,
    },
  }
}

/** Scan the plugins folder (startup + "Reload plugins"). */
export function reloadPlugins(): { plugins: PluginInfo[]; errors: PluginLoadError[] } {
  const root = pluginsDir()
  const plugins: PluginInfo[] = []
  const errors: PluginLoadError[] = []
  try {
    fs.mkdirSync(root, { recursive: true })
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue
      const dir = path.join(root, ent.name)
      const r = readPluginDir(dir)
      if (!r.info) {
        errors.push({ folder: ent.name, dir, errors: r.errors })
        continue
      }
      if (plugins.some((p) => p.id === r.info!.id)) {
        errors.push({ folder: ent.name, dir, errors: [`Duplicate plugin id "${r.info.id}" (already loaded from another folder)`] })
        continue
      }
      plugins.push(r.info)
    }
  } catch (e) {
    errors.push({ folder: '.', dir: root, errors: [e instanceof Error ? e.message : String(e)] })
  }
  plugins.sort((a, b) => a.name.localeCompare(b.name))
  cached = { plugins, errors }
  return cached
}

function loaded(): { plugins: PluginInfo[]; errors: PluginLoadError[] } {
  return cached ?? reloadPlugins()
}

export function resetPluginCache(): void {
  cached = null
}

export function listPluginsResult(): PluginListResult {
  const { plugins, errors } = loaded()
  return { plugins, errors, pluginsDir: pluginsDir(), disabled: readState().disabled }
}

/** Contributions from enabled installed plugins. */
export function getPluginContributions(): PluginContributions {
  const out: PluginContributions = { providers: [], personas: [], promptPacks: [], mcpServers: [] }
  for (const p of loaded().plugins) {
    if (!p.enabled || !p.manifest) continue
    const c = p.manifest.contributes
    for (const x of c.providers ?? []) out.providers.push({ ...x, pluginId: p.id })
    for (const x of c.personas ?? []) out.personas.push({ ...(x as PluginPersona), pluginId: p.id, pluginName: p.name })
    for (const x of c.promptPacks ?? []) out.promptPacks.push({ ...(x as PluginPromptPack), pluginId: p.id, pluginName: p.name })
    for (const x of c.mcpServers ?? []) out.mcpServers.push({ ...(x as PluginMcpServerPreset), pluginId: p.id, pluginName: p.name })
  }
  return out
}

export function setPluginEnabled(id: string, enabled: boolean): PluginListResult {
  const s = readState()
  const set = new Set(s.disabled)
  if (enabled) set.delete(id)
  else set.add(id)
  writeState({ disabled: [...set] })
  reloadPlugins()
  return listPluginsResult()
}

/* ---------------- install / remove ---------------- */

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** Collect asset files from a folder (relative paths), skipping non-assets. */
function collectFolder(src: string): { files: Array<{ rel: string; data: Buffer }>; skipped: string[] } {
  const files: Array<{ rel: string; data: Buffer }> = []
  const skipped: string[] = []
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > 4) return
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue
      const abs = path.join(dir, ent.name)
      const r = rel ? `${rel}/${ent.name}` : ent.name
      if (ent.isDirectory()) walk(abs, r, depth + 1)
      else if (ent.isFile()) {
        if (ASSET_EXT.has(path.extname(ent.name).toLowerCase()) && fs.statSync(abs).size <= 2 * 1024 * 1024) {
          files.push({ rel: r, data: fs.readFileSync(abs) })
        } else skipped.push(r)
      }
    }
  }
  walk(src, '', 0)
  return { files, skipped }
}

function collectZip(zipPath: string): { files: Array<{ rel: string; data: Buffer }>; skipped: string[] } {
  const entries = readZip(fs.readFileSync(zipPath))
  // Allow plugin.json at root or inside a single top-level folder.
  let prefix = ''
  if (!entries.some((e) => e.name === 'plugin.json')) {
    const nested = entries.filter((e) => /^[^/]+\/plugin\.json$/.test(e.name))
    if (nested.length === 1) prefix = nested[0].name.replace(/plugin\.json$/, '')
  }
  const files: Array<{ rel: string; data: Buffer }> = []
  const skipped: string[] = []
  for (const e of entries) {
    if (prefix && !e.name.startsWith(prefix)) continue
    const rel = e.name.slice(prefix.length)
    if (!rel || rel.split('/').some((seg) => seg.startsWith('.')) || rel.startsWith('__MACOSX')) continue
    if (ASSET_EXT.has(path.extname(rel).toLowerCase())) files.push({ rel, data: e.data })
    else skipped.push(rel)
  }
  return { files, skipped }
}

/**
 * Install from a folder or .zip: validate in a staging dir, then move into plugins/<id>/.
 * An existing version is moved to plugins/.previous/<id>-<timestamp>/ (not deleted).
 */
export function installPluginFrom(srcPath: string): PluginInstallResult {
  const warnings: string[] = []
  let collected: { files: Array<{ rel: string; data: Buffer }>; skipped: string[] }
  try {
    const st = fs.statSync(srcPath)
    if (st.isDirectory()) collected = collectFolder(srcPath)
    else if (/\.zip$/i.test(srcPath)) collected = collectZip(srcPath)
    else if (path.basename(srcPath) === 'plugin.json') collected = collectFolder(path.dirname(srcPath))
    else return { ok: false, errors: ['Pick a plugin folder (containing plugin.json) or a .zip'] }
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] }
  }
  if (!collected.files.some((f) => f.rel === 'plugin.json')) {
    return { ok: false, errors: ['No plugin.json found at the top of that folder / zip'] }
  }
  if (collected.skipped.length) {
    warnings.push(`Skipped ${collected.skipped.length} non-asset file(s) (plugins can't run code): ${collected.skipped.slice(0, 5).join(', ')}${collected.skipped.length > 5 ? '…' : ''}`)
  }

  const root = pluginsDir()
  fs.mkdirSync(root, { recursive: true })
  const staging = path.join(root, `.staging-${stamp()}`)
  try {
    for (const f of collected.files) {
      const dest = path.join(staging, f.rel)
      if (!dest.startsWith(staging + path.sep)) throw new Error(`Unsafe path: ${f.rel}`)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, f.data)
    }
    const r = readPluginDir(staging)
    if (!r.info) {
      fs.rmSync(staging, { recursive: true, force: true })
      return { ok: false, errors: r.errors, warnings }
    }
    const target = path.join(root, r.info.id)
    if (fs.existsSync(target)) {
      const prevDir = path.join(root, '.previous')
      fs.mkdirSync(prevDir, { recursive: true })
      fs.renameSync(target, path.join(prevDir, `${r.info.id}-${stamp()}`))
      warnings.push(`Replaced an existing "${r.info.id}" (old copy kept in plugins/.previous/)`)
    }
    fs.renameSync(staging, target)
    reloadPlugins()
    const installed = loaded().plugins.find((p) => p.id === r.info!.id)
    return { ok: true, plugin: installed, warnings }
  } catch (e) {
    try {
      fs.rmSync(staging, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)], warnings }
  }
}

/** Remove = move to <userData>/plugins-removed/<id>-<ts>/ (recoverable). */
export function removePlugin(id: string): PluginListResult {
  const p = loaded().plugins.find((x) => x.id === id)
  if (!p?.dir) throw new Error(`Plugin not installed: ${id}`)
  const trash = path.join(resolveUserDataDir(), 'plugins-removed')
  fs.mkdirSync(trash, { recursive: true })
  fs.renameSync(p.dir, path.join(trash, `${id}-${stamp()}`))
  const s = readState()
  writeState({ disabled: s.disabled.filter((d) => d !== id) })
  reloadPlugins()
  return listPluginsResult()
}
