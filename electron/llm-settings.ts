/**
 * LEGACY (v0.1) LLM prefs: lkv-llm.json + lkv-groq-key / lkv-xai-key.
 * Still read for migration and key lookup — the provider registry (provider-store.ts)
 * is now the source of truth for routing. This file is never deleted.
 * Never log API keys.
 * Grok = xAI (api.x.ai). Groq = GroqCloud (api.groq.com). Distinct vendors.
 */
import fs from 'fs'
import path from 'path'
import { resolveUserDataDir, setUserDataDirOverride } from './user-data'

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

let cachedSettings: LlmSettings | null = null

/** Override userData dir (tests). Null = default resolution (see user-data.ts). */
export function setLlmUserDataDir(dir: string | null): void {
  setUserDataDirOverride(dir)
  cachedSettings = null
}

export function legacySettingsPath(): string {
  return path.join(resolveUserDataDir(), SETTINGS_FILE)
}

export function legacyXaiKeyPath(): string {
  return path.join(resolveUserDataDir(), KEY_FILE)
}

export function legacyGroqKeyPath(): string {
  return path.join(resolveUserDataDir(), GROQ_KEY_FILE)
}

export function readLegacySettingsFile(): Partial<LlmSettings> {
  try {
    const p = legacySettingsPath()
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
  fs.writeFileSync(legacySettingsPath(), JSON.stringify(settings, null, 2), 'utf8')
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
  const merged = mergeLlmSettings(readLegacySettingsFile(), DEFAULTS)
  cachedSettings = merged
  return { ...merged }
}

export function setLlmSettings(partial: Partial<LlmSettings>): LlmSettings {
  const next = mergeLlmSettings(partial, getLlmSettings())
  writeSettingsFile(next)
  cachedSettings = next
  return { ...next }
}

export function envXaiKey(): string | null {
  const a = process.env.LKV_XAI_API_KEY?.trim()
  if (a) return a
  const b = process.env.XAI_API_KEY?.trim()
  if (b) return b
  return null
}

export function envGroqKey(): string | null {
  const a = process.env.LKV_GROQ_API_KEY?.trim()
  if (a) return a
  const b = process.env.GROQ_API_KEY?.trim()
  if (b) return b
  return null
}

export function readKeyFileAt(p: string): string | null {
  try {
    if (!fs.existsSync(p)) return null
    const v = fs.readFileSync(p, 'utf8').trim()
    return v || null
  } catch {
    return null
  }
}

export function writeKeyFileAt(p: string, key: string | null): void {
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
  return envXaiKey() ?? readKeyFileAt(legacyXaiKeyPath())
}

export function hasXaiApiKey(): boolean {
  return !!getXaiApiKey()
}

/**
 * Save or clear xAI key file. Passing null deletes the file.
 * Env keys are not written to disk unless the user saves via this API.
 */
export function setXaiApiKey(key: string | null): void {
  writeKeyFileAt(legacyXaiKeyPath(), key)
}

/** Prefer env, then saved file. Never log. */
export function getGroqApiKey(): string | null {
  return envGroqKey() ?? readKeyFileAt(legacyGroqKeyPath())
}

export function hasGroqApiKey(): boolean {
  return !!getGroqApiKey()
}

/**
 * Save or clear Groq key file. Passing null deletes the file.
 * Env keys are not written to disk unless the user saves via this API.
 */
export function setGroqApiKey(key: string | null): void {
  writeKeyFileAt(legacyGroqKeyPath(), key)
}

export function getLlmSettingsPublic(): LlmSettingsPublic {
  const s = getLlmSettings()
  return { ...s, hasKey: hasXaiApiKey(), hasGroqKey: hasGroqApiKey() }
}

export function getDefaultLlmSettings(): LlmSettings {
  return { ...DEFAULTS }
}
