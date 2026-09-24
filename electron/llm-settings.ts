/**
 * Persist LLM provider prefs + optional xAI / Groq API keys (local files only).
 * Never log API keys.
 * Grok = xAI (api.x.ai). Groq = GroqCloud (api.groq.com). Distinct vendors.
 */
import fs from 'fs'
import path from 'path'
import os from 'os'

export type LlmProviderChoice = 'auto' | 'ollama' | 'grok' | 'groq'

export interface LlmSettings {
  provider: LlmProviderChoice
  grokEnabled: boolean
  grokModel: string
  groqEnabled: boolean
  groqModel: string
}

export interface LlmSettingsPublic extends LlmSettings {
  /** xAI Grok key present (env or file) */
  hasKey: boolean
  /** GroqCloud key present (env or file) */
  hasGroqKey: boolean
}

const DEFAULTS: LlmSettings = {
  provider: 'auto',
  grokEnabled: false,
  grokModel: 'grok-4.3',
  groqEnabled: false,
  groqModel: 'openai/gpt-oss-20b',
}

const SETTINGS_FILE = 'lkv-llm.json'
const KEY_FILE = 'lkv-xai-key'
const GROQ_KEY_FILE = 'lkv-groq-key'

/** Override userData dir (tests). Null = use Electron app.getPath or tmp fallback. */
let userDataOverride: string | null = null
let cachedSettings: LlmSettings | null = null

export function setLlmUserDataDir(dir: string | null): void {
  userDataOverride = dir
  cachedSettings = null
}

function resolveUserDataDir(): string {
  if (userDataOverride) return userDataOverride
  try {
    // Lazy require so unit tests / scripts can override without Electron ready
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { app?: { getPath: (n: string) => string } }
    if (electron?.app?.getPath) {
      return electron.app.getPath('userData')
    }
  } catch {
    /* not in Electron */
  }
  const fallback = path.join(os.tmpdir(), 'lkv-userdata')
  fs.mkdirSync(fallback, { recursive: true })
  return fallback
}

function settingsPath(): string {
  return path.join(resolveUserDataDir(), SETTINGS_FILE)
}

function keyPath(): string {
  return path.join(resolveUserDataDir(), KEY_FILE)
}

function groqKeyPath(): string {
  return path.join(resolveUserDataDir(), GROQ_KEY_FILE)
}

function readSettingsFile(): Partial<LlmSettings> {
  try {
    const p = settingsPath()
    if (!fs.existsSync(p)) return {}
    const raw = fs.readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw) as Partial<LlmSettings>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeSettingsFile(settings: LlmSettings): void {
  const dir = resolveUserDataDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8')
}

function isProviderChoice(v: unknown): v is LlmProviderChoice {
  return v === 'auto' || v === 'ollama' || v === 'grok' || v === 'groq'
}

/** Merge partial onto defaults; coerce invalid values. Pure — exported for tests. */
export function mergeLlmSettings(
  partial: Partial<LlmSettings> | null | undefined,
  base: LlmSettings = DEFAULTS
): LlmSettings {
  const provider = isProviderChoice(partial?.provider) ? partial.provider : base.provider
  const grokEnabled =
    typeof partial?.grokEnabled === 'boolean' ? partial.grokEnabled : base.grokEnabled
  const grokModel =
    typeof partial?.grokModel === 'string' && partial.grokModel.trim()
      ? partial.grokModel.trim()
      : base.grokModel
  const groqEnabled =
    typeof partial?.groqEnabled === 'boolean' ? partial.groqEnabled : base.groqEnabled
  const groqModel =
    typeof partial?.groqModel === 'string' && partial.groqModel.trim()
      ? partial.groqModel.trim()
      : base.groqModel
  return { provider, grokEnabled, grokModel, groqEnabled, groqModel }
}

export function getLlmSettings(): LlmSettings {
  if (cachedSettings) return { ...cachedSettings }
  const merged = mergeLlmSettings(readSettingsFile(), DEFAULTS)
  cachedSettings = merged
  return { ...merged }
}

export function setLlmSettings(partial: Partial<LlmSettings>): LlmSettings {
  const next = mergeLlmSettings(partial, getLlmSettings())
  writeSettingsFile(next)
  cachedSettings = next
  return { ...next }
}

function envXaiKey(): string | null {
  const a = process.env.LKV_XAI_API_KEY?.trim()
  if (a) return a
  const b = process.env.XAI_API_KEY?.trim()
  if (b) return b
  return null
}

function envGroqKey(): string | null {
  const a = process.env.LKV_GROQ_API_KEY?.trim()
  if (a) return a
  const b = process.env.GROQ_API_KEY?.trim()
  if (b) return b
  return null
}

function readKeyFileAt(p: string): string | null {
  try {
    if (!fs.existsSync(p)) return null
    const v = fs.readFileSync(p, 'utf8').trim()
    return v || null
  } catch {
    return null
  }
}

function writeKeyFileAt(p: string, key: string | null): void {
  const dir = resolveUserDataDir()
  fs.mkdirSync(dir, { recursive: true })
  if (key === null || key.trim() === '') {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      /* ignore */
    }
    return
  }
  fs.writeFileSync(p, key.trim(), { encoding: 'utf8', mode: 0o600 })
  try {
    fs.chmodSync(p, 0o600)
  } catch {
    /* Windows may ignore mode */
  }
}

/** Prefer env, then saved file. Never log. */
export function getXaiApiKey(): string | null {
  return envXaiKey() ?? readKeyFileAt(keyPath())
}

export function hasXaiApiKey(): boolean {
  return !!getXaiApiKey()
}

/**
 * Save or clear xAI key file. Passing null deletes the file.
 * Env keys are not written to disk unless the user saves via this API.
 */
export function setXaiApiKey(key: string | null): void {
  writeKeyFileAt(keyPath(), key)
}

/** Prefer env, then saved file. Never log. */
export function getGroqApiKey(): string | null {
  return envGroqKey() ?? readKeyFileAt(groqKeyPath())
}

export function hasGroqApiKey(): boolean {
  return !!getGroqApiKey()
}

/**
 * Save or clear Groq key file. Passing null deletes the file.
 * Env keys are not written to disk unless the user saves via this API.
 */
export function setGroqApiKey(key: string | null): void {
  writeKeyFileAt(groqKeyPath(), key)
}

export function getLlmSettingsPublic(): LlmSettingsPublic {
  const s = getLlmSettings()
  return { ...s, hasKey: hasXaiApiKey(), hasGroqKey: hasGroqApiKey() }
}

export function getDefaultLlmSettings(): LlmSettings {
  return { ...DEFAULTS }
}
