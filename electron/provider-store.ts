/**
 * Provider registry persistence: <userData>/lkv-providers.json (+ per-provider key files).
 *
 * - Local providers (Ollama, LM Studio) always exist and are enabled by default.
 * - Cloud providers are opt-in: they only appear once the user adds one (or migrated from
 *   the legacy lkv-llm.json), and Auto never picks a cloud provider unless it's enabled.
 * - Keys: env var → <userData>/lkv-keys/<id>.key (0600) → legacy lkv-groq-key / lkv-xai-key.
 *   Keys never go to the renderer (only hasKey) and are never logged or stored in SQLite.
 * - Legacy files (lkv-llm.json, lkv-groq-key, lkv-xai-key) are read, never deleted.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { resolveUserDataDir } from './user-data'
import {
  readLegacySettingsFile,
  legacySettingsPath,
  legacyGroqKeyPath,
  legacyXaiKeyPath,
  readKeyFileAt,
  writeKeyFileAt,
} from './llm-settings'
import {
  BUILTIN_PRESETS,
  PRESET_ENV_KEYS,
  getBuiltinPreset,
  lmStudioBaseUrl,
  ollamaBaseUrl,
} from './providers/presets'
import { getPluginContributions } from './plugin-loader'
import type {
  ProviderConfig,
  ProviderDraft,
  ProviderKind,
  ProviderPresetInfo,
  ProviderSelection,
  ProviderSource,
} from './types'

export const PROVIDERS_FILE = 'lkv-providers.json'
export const KEYS_DIR = 'lkv-keys'

export interface StoredProvider {
  id: string
  presetId?: string
  kind: ProviderKind
  label: string
  baseUrl: string
  model: string
  local: boolean
  enabled: boolean
  source: Exclude<ProviderSource, 'plugin'>
}

export interface ProvidersFile {
  schemaVersion: 1
  selected: ProviderSelection
  providers: StoredProvider[]
  /** Overrides for plugin-contributed providers (enabled / model / baseUrl). */
  pluginOverrides: Record<string, { enabled?: boolean; model?: string; baseUrl?: string }>
  /** Human-readable note of what migration did (kept for support/debugging). */
  migration?: { from: 'lkv-llm.json' | 'fresh'; at: string; note: string }
}

const KINDS: ProviderKind[] = ['ollama', 'openai-compatible', 'anthropic', 'gemini']
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/

let cache: ProvidersFile | null = null

export function resetProviderStoreCache(): void {
  cache = null
}

function filePath(): string {
  return path.join(resolveUserDataDir(), PROVIDERS_FILE)
}

function localBuiltins(): StoredProvider[] {
  return [
    {
      id: 'ollama',
      presetId: 'ollama',
      kind: 'ollama',
      label: 'Ollama',
      baseUrl: ollamaBaseUrl(),
      model: '',
      local: true,
      enabled: true,
      source: 'builtin',
    },
    {
      id: 'lmstudio',
      presetId: 'lmstudio',
      kind: 'openai-compatible',
      label: 'LM Studio',
      baseUrl: lmStudioBaseUrl(),
      model: '',
      local: true,
      enabled: true,
      source: 'builtin',
    },
  ]
}

function legacyCloud(presetId: 'groq' | 'xai', enabled: boolean, model?: string): StoredProvider {
  const preset = getBuiltinPreset(presetId)!
  const envBase =
    presetId === 'groq' ? process.env.LKV_GROQ_BASE_URL?.trim() : process.env.LKV_XAI_BASE_URL?.trim()
  return {
    id: presetId,
    presetId,
    kind: preset.kind,
    label: preset.label,
    baseUrl: (envBase || preset.baseUrl).replace(/\/+$/, ''),
    model: model?.trim() || preset.defaultModel,
    local: false,
    enabled,
    source: 'builtin',
  }
}

/**
 * Build the initial registry. Pure w.r.t. inputs → exported for tests.
 * Legacy mapping (keeps an existing explicit cloud choice working):
 *   provider 'groq' → selected 'groq'; 'grok' → 'xai'; 'ollama' → 'ollama'
 *   provider 'auto' + groqEnabled → 'groq' (legacy Auto preferred Groq first)
 *   provider 'auto' + grokEnabled only → 'xai'
 *   otherwise → 'auto' (local-first)
 */
export function buildInitialProvidersFile(input: {
  legacy: {
    provider?: string
    groqEnabled?: boolean
    groqModel?: string
    grokEnabled?: boolean
    grokModel?: string
  } | null
  legacyGroqKeyFile: boolean
  legacyXaiKeyFile: boolean
}): ProvidersFile {
  const providers = localBuiltins()
  const legacy = input.legacy
  const now = new Date().toISOString()
  if (!legacy && !input.legacyGroqKeyFile && !input.legacyXaiKeyFile) {
    return {
      schemaVersion: 1,
      selected: 'auto',
      providers,
      pluginOverrides: {},
      migration: { from: 'fresh', at: now, note: 'Fresh install: local-first Auto (Ollama → LM Studio).' },
    }
  }
  const l = legacy ?? {}
  const groqOn = l.groqEnabled === true || l.provider === 'groq'
  const xaiOn = l.grokEnabled === true || l.provider === 'grok'
  if (groqOn || input.legacyGroqKeyFile) providers.push(legacyCloud('groq', groqOn, l.groqModel))
  if (xaiOn || input.legacyXaiKeyFile) providers.push(legacyCloud('xai', xaiOn, l.grokModel))

  let selected: ProviderSelection = 'auto'
  if (l.provider === 'groq') selected = 'groq'
  else if (l.provider === 'grok') selected = 'xai'
  else if (l.provider === 'ollama') selected = 'ollama'
  else if (groqOn) selected = 'groq'
  else if (xaiOn) selected = 'xai'

  return {
    schemaVersion: 1,
    selected,
    providers,
    pluginOverrides: {},
    migration: {
      from: 'lkv-llm.json',
      at: now,
      note: `Migrated legacy provider=${l.provider ?? 'auto'} groqEnabled=${!!l.groqEnabled} grokEnabled=${!!l.grokEnabled} → selected=${selected}. Legacy files left untouched.`,
    },
  }
}

function sanitize(file: Partial<ProvidersFile>): ProvidersFile {
  const providers: StoredProvider[] = []
  const seen = new Set<string>()
  for (const raw of Array.isArray(file.providers) ? file.providers : []) {
    if (!raw || typeof raw !== 'object') continue
    const p = raw as StoredProvider
    if (typeof p.id !== 'string' || !SAFE_ID.test(p.id) || seen.has(p.id)) continue
    if (!KINDS.includes(p.kind)) continue
    seen.add(p.id)
    providers.push({
      id: p.id,
      presetId: typeof p.presetId === 'string' ? p.presetId : undefined,
      kind: p.kind,
      label: typeof p.label === 'string' && p.label.trim() ? p.label.trim() : p.id,
      baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl.trim().replace(/\/+$/, '') : '',
      model: typeof p.model === 'string' ? p.model.trim() : '',
      local: p.local === true,
      enabled: p.enabled !== false,
      source: p.source === 'user' ? 'user' : 'builtin',
    })
  }
  // Local builtins always exist (user may disable, not delete).
  for (const b of localBuiltins()) {
    if (!seen.has(b.id)) providers.unshift(b)
  }
  const selected =
    typeof file.selected === 'string' && (file.selected === 'auto' || SAFE_ID.test(file.selected))
      ? file.selected
      : 'auto'
  const pluginOverrides =
    file.pluginOverrides && typeof file.pluginOverrides === 'object' ? file.pluginOverrides : {}
  return { schemaVersion: 1, selected, providers, pluginOverrides, migration: file.migration }
}

export function loadProvidersFile(): ProvidersFile {
  if (cache) return cache
  const p = filePath()
  if (fs.existsSync(p)) {
    try {
      cache = sanitize(JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<ProvidersFile>)
      return cache
    } catch {
      // Corrupt file: keep a copy, rebuild from legacy. Never silently discard user data.
      try {
        fs.copyFileSync(p, `${p}.corrupt-${Date.now()}`)
      } catch {
        /* ignore */
      }
    }
  }
  const legacyExists = fs.existsSync(legacySettingsPath())
  cache = buildInitialProvidersFile({
    legacy: legacyExists ? readLegacySettingsFile() : null,
    legacyGroqKeyFile: fs.existsSync(legacyGroqKeyPath()),
    legacyXaiKeyFile: fs.existsSync(legacyXaiKeyPath()),
  })
  saveProvidersFile(cache)
  return cache
}

export function saveProvidersFile(file: ProvidersFile): void {
  const dir = resolveUserDataDir()
  fs.mkdirSync(dir, { recursive: true })
  const p = filePath()
  const tmp = `${p}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf8')
  fs.renameSync(tmp, p)
  cache = file
}

/* ---------------- keys ---------------- */

function keyFileName(id: string): string {
  return `${id.replace(/[^a-zA-Z0-9._-]/g, '_')}.key`
}

function keysDir(): string {
  return path.join(resolveUserDataDir(), KEYS_DIR)
}

export function providerKeyPath(id: string): string {
  return path.join(keysDir(), keyFileName(id))
}

function legacyKeyPathFor(id: string): string | null {
  if (id === 'groq') return legacyGroqKeyPath()
  if (id === 'xai') return legacyXaiKeyPath()
  return null
}

function envKeyFor(presetId: string | undefined): { key: string; env: string } | null {
  if (!presetId) return null
  for (const name of PRESET_ENV_KEYS[presetId] ?? []) {
    const v = process.env[name]?.trim()
    if (v) return { key: v, env: name }
  }
  return null
}

/** Main-process only. Never send to renderer, never log. */
export function getProviderKey(id: string, presetId?: string): string | null {
  const env = envKeyFor(presetId)
  if (env) return env.key
  const fromFile = readKeyFileAt(providerKeyPath(id))
  if (fromFile) return fromFile
  const legacy = legacyKeyPathFor(id)
  return legacy ? readKeyFileAt(legacy) : null
}

export function getProviderKeySource(id: string, presetId?: string): 'env' | 'file' | null {
  if (envKeyFor(presetId)) return 'env'
  if (readKeyFileAt(providerKeyPath(id))) return 'file'
  const legacy = legacyKeyPathFor(id)
  return legacy && readKeyFileAt(legacy) ? 'file' : null
}

/** Save (string) or clear (null/'') a provider key. Groq / xAI keep using legacy files. */
export function setProviderKey(id: string, key: string | null): void {
  const legacy = legacyKeyPathFor(id)
  if (legacy) {
    writeKeyFileAt(legacy, key)
    return
  }
  const dir = keysDir()
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    fs.chmodSync(dir, 0o700)
  } catch {
    /* Windows */
  }
  writeKeyFileAt(providerKeyPath(id), key)
}

/* ---------------- public registry ---------------- */

export const PLUGIN_PROVIDER_PREFIX = 'plugin:'

export function pluginProviderId(pluginId: string, presetId: string): string {
  return `${PLUGIN_PROVIDER_PREFIX}${pluginId}:${presetId}`
}

function toConfig(p: StoredProvider | (Omit<StoredProvider, 'source'> & { source: ProviderSource; pluginId?: string })): ProviderConfig {
  const preset = p.presetId ? getBuiltinPreset(p.presetId) : undefined
  const requiresKey = p.local ? false : preset ? preset.requiresKey : p.kind === 'anthropic' || p.kind === 'gemini'
  return {
    id: p.id,
    kind: p.kind,
    label: p.label,
    baseUrl: p.baseUrl,
    model: p.model,
    hasKey: !!getProviderKey(p.id, p.presetId),
    requiresKey,
    local: p.local,
    enabled: p.enabled,
    source: p.source,
    presetId: p.presetId,
    pluginId: 'pluginId' in p ? p.pluginId : undefined,
    keySource: getProviderKeySource(p.id, p.presetId),
  }
}

/** All providers, local first (Ollama, LM Studio, other local), then cloud. */
export function listProviderConfigs(): ProviderConfig[] {
  const file = loadProvidersFile()
  // Env overrides win for the built-in local servers (LKV_OLLAMA_URL / LKV_LMSTUDIO_URL).
  const envBase = (id: string) =>
    id === 'ollama'
      ? process.env.LKV_OLLAMA_URL?.trim()
      : id === 'lmstudio'
        ? process.env.LKV_LMSTUDIO_URL?.trim()
        : undefined
  const out: ProviderConfig[] = file.providers.map((p) => {
    const env = envBase(p.id)
    return toConfig(env ? { ...p, baseUrl: env.replace(/\/+$/, '') } : p)
  })
  for (const pp of getPluginContributions().providers) {
    const id = pluginProviderId(pp.pluginId, pp.id)
    const ov = file.pluginOverrides[id] ?? {}
    out.push(
      toConfig({
        id,
        presetId: undefined,
        kind: pp.kind,
        label: pp.label,
        baseUrl: (ov.baseUrl ?? pp.baseUrl).replace(/\/+$/, ''),
        model: ov.model ?? pp.defaultModel,
        local: pp.local === true,
        enabled: ov.enabled === true, // plugin providers are opt-in
        source: 'plugin',
        pluginId: pp.pluginId,
      })
    )
    // requiresKey for plugin presets comes from the manifest
    const last = out[out.length - 1]
    last.requiresKey = pp.local === true ? false : pp.requiresKey !== false
  }
  const rank = (p: ProviderConfig) =>
    p.id === 'ollama' ? 0 : p.id === 'lmstudio' ? 1 : p.local ? 2 : 3
  return out
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
    .map((x) => x.p)
}

export function getProviderConfig(id: string): ProviderConfig | undefined {
  return listProviderConfigs().find((p) => p.id === id)
}

export function getSelection(): ProviderSelection {
  const sel = loadProvidersFile().selected
  if (sel === 'auto') return sel
  return listProviderConfigs().some((p) => p.id === sel) ? sel : 'auto'
}

export function setSelection(sel: ProviderSelection): ProviderSelection {
  const file = loadProvidersFile()
  if (sel !== 'auto' && !listProviderConfigs().some((p) => p.id === sel)) {
    throw new Error(`Unknown provider: ${sel}`)
  }
  saveProvidersFile({ ...file, selected: sel })
  return sel
}

export function setProviderEnabled(id: string, enabled: boolean): void {
  const file = loadProvidersFile()
  if (id.startsWith(PLUGIN_PROVIDER_PREFIX)) {
    const ov = { ...(file.pluginOverrides[id] ?? {}), enabled }
    saveProvidersFile({ ...file, pluginOverrides: { ...file.pluginOverrides, [id]: ov } })
    return
  }
  const providers = file.providers.map((p) => (p.id === id ? { ...p, enabled } : p))
  if (!providers.some((p) => p.id === id)) throw new Error(`Unknown provider: ${id}`)
  saveProvidersFile({ ...file, providers })
}

function validateDraft(d: ProviderDraft): string[] {
  const errs: string[] = []
  if (!KINDS.includes(d.kind)) errs.push(`Unknown provider type "${d.kind}"`)
  if (!d.label?.trim()) errs.push('Name is required')
  const url = d.baseUrl?.trim()
  if (!url) errs.push('Base URL is required')
  else {
    try {
      const u = new URL(url)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') errs.push('Base URL must start with http:// or https://')
    } catch {
      errs.push(`Base URL is not a valid URL: ${url}`)
    }
  }
  return errs
}

export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.local')
  } catch {
    return false
  }
}

/** Add or edit a provider. Returns the saved config. apiKey: undefined keep, ''/null clear, string set. */
export function upsertProvider(d: ProviderDraft): ProviderConfig {
  const errs = validateDraft(d)
  if (errs.length) throw new Error(errs.join('; '))
  const file = loadProvidersFile()
  const baseUrl = d.baseUrl.trim().replace(/\/+$/, '')
  const local = d.local ?? isLocalUrl(baseUrl)

  if (d.id?.startsWith(PLUGIN_PROVIDER_PREFIX)) {
    const ov = {
      ...(file.pluginOverrides[d.id] ?? {}),
      model: d.model.trim(),
      baseUrl,
      ...(d.enabled !== undefined ? { enabled: d.enabled } : {}),
    }
    saveProvidersFile({ ...file, pluginOverrides: { ...file.pluginOverrides, [d.id]: ov } })
    if (d.apiKey !== undefined) setProviderKey(d.id, d.apiKey || null)
    return getProviderConfig(d.id)!
  }

  let id = d.id
  const providers = [...file.providers]
  if (id) {
    const i = providers.findIndex((p) => p.id === id)
    if (i < 0) throw new Error(`Unknown provider: ${id}`)
    const prev = providers[i]
    providers[i] = {
      ...prev,
      kind: prev.source === 'builtin' ? prev.kind : d.kind,
      label: d.label.trim(),
      baseUrl,
      model: d.model.trim(),
      local: prev.id === 'ollama' || prev.id === 'lmstudio' ? true : local,
      enabled: d.enabled ?? prev.enabled,
    }
  } else {
    id = `usr_${crypto.randomBytes(5).toString('hex')}`
    providers.push({
      id,
      presetId: d.presetId,
      kind: d.kind,
      label: d.label.trim(),
      baseUrl,
      model: d.model.trim(),
      local,
      enabled: d.enabled ?? true,
      source: 'user',
    })
  }
  saveProvidersFile({ ...file, providers })
  if (d.apiKey !== undefined) setProviderKey(id, d.apiKey || null)
  return getProviderConfig(id)!
}

/**
 * Remove a user/migrated cloud provider. Local builtins can only be disabled.
 * Deletes that provider's own key file under lkv-keys/ (user-initiated); legacy
 * lkv-groq-key / lkv-xai-key files are left in place.
 */
export function removeProvider(id: string): boolean {
  if (id === 'ollama' || id === 'lmstudio') throw new Error('Built-in local providers can be disabled, not removed.')
  if (id.startsWith(PLUGIN_PROVIDER_PREFIX)) throw new Error('Plugin providers are removed by removing or disabling the plugin.')
  const file = loadProvidersFile()
  const providers = file.providers.filter((p) => p.id !== id)
  if (providers.length === file.providers.length) return false
  saveProvidersFile({ ...file, providers, selected: file.selected === id ? 'auto' : file.selected })
  if (!legacyKeyPathFor(id)) {
    try {
      const kp = providerKeyPath(id)
      if (fs.existsSync(kp)) fs.unlinkSync(kp)
    } catch {
      /* ignore */
    }
  }
  return true
}

/** Presets for the Add provider dialog: built-ins + plugin-contributed. */
export function listPresets(): ProviderPresetInfo[] {
  const out = [...BUILTIN_PRESETS]
  for (const pp of getPluginContributions().providers) {
    out.push({
      id: pluginProviderId(pp.pluginId, pp.id),
      kind: pp.kind,
      label: `${pp.label} (plugin)`,
      baseUrl: pp.baseUrl,
      defaultModel: pp.defaultModel,
      local: pp.local === true,
      requiresKey: pp.local === true ? false : pp.requiresKey !== false,
      supportsModelList: true,
      docsUrl: pp.docsUrl,
      notes: pp.notes,
      pluginId: pp.pluginId,
    })
  }
  return out
}
