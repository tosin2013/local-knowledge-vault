/**
 * Shared LLM router: Ollama + Groq (GroqCloud) + Grok (xAI).
 * Auto cloud priority when multiple enabled: Groq → xAI Grok → Ollama (fallback on hard failure).
 */
import { ollamaGenerate, ollamaHealth, pickModel } from './ollama'
import { grokGenerate, grokHealth, type GrokHealth } from './grok'
import { groqGenerate, groqHealth, type GroqHealth } from './groq'
import {
  getLlmSettings,
  hasXaiApiKey,
  hasGroqApiKey,
  type LlmProviderChoice,
  type LlmSettings,
} from './llm-settings'
import type { OllamaHealth } from './types'

export type LlmProviderId = 'ollama' | 'grok' | 'groq'

export interface LlmStatus {
  ollama: OllamaHealth
  grok: GrokHealth
  groq: GroqHealth
  active: LlmProviderId | null
  message: string
}

export interface ResolveProviderResult {
  provider: LlmProviderId | null
  model: string | null
  status: LlmStatus
}

export interface ResolveInput {
  settings: LlmSettings
  /** xAI Grok key present */
  hasKey: boolean
  /** GroqCloud key present */
  hasGroqKey: boolean
  ollama: OllamaHealth
  grok: GrokHealth
  groq: GroqHealth
}

/**
 * Pure resolution — unit-testable without network.
 * Auto priority (when multiple cloud enabled): Groq first (free path), then xAI Grok,
 * then Ollama on hard failure / missing key.
 */
export function resolveProviderFromHealth(input: ResolveInput): ResolveProviderResult {
  const { settings, hasKey, hasGroqKey, ollama, grok, groq } = input
  const choice: LlmProviderChoice = settings.provider

  const ollamaModel = ollama.ok ? pickModel(ollama.models ?? []) : null
  const grokModel =
    grok.ok && hasKey
      ? (grok.models?.[0] ?? settings.grokModel)
      : hasKey
        ? settings.grokModel
        : null
  const groqModel =
    groq.ok && hasGroqKey
      ? (groq.models?.[0] ?? settings.groqModel)
      : hasGroqKey
        ? settings.groqModel
        : null

  const build = (
    provider: LlmProviderId | null,
    model: string | null,
    message: string
  ): ResolveProviderResult => ({
    provider,
    model,
    status: { ollama, grok, groq, active: provider, message },
  })

  if (choice === 'ollama') {
    if (ollama.ok && ollamaModel) {
      return build('ollama', ollamaModel, 'Ollama ready')
    }
    if (ollama.ok && !ollamaModel) {
      return build(null, null, 'Ollama reachable but no models installed')
    }
    return build(null, null, 'AI offline — search still works')
  }

  if (choice === 'groq') {
    if (!hasGroqKey) {
      return build(null, null, 'Groq enabled but no API key')
    }
    if (groq.ok && groqModel) {
      return build('groq', groqModel, `Groq ready (${groqModel})`)
    }
    return build(
      null,
      null,
      groq.error ? `Groq error: ${groq.error}` : 'AI offline — search still works'
    )
  }

  if (choice === 'grok') {
    if (!hasKey) {
      return build(null, null, 'Grok enabled but no API key')
    }
    if (grok.ok && grokModel) {
      return build('grok', grokModel, `Grok ready (${grokModel})`)
    }
    return build(
      null,
      null,
      grok.error ? `Grok error: ${grok.error}` : 'AI offline — search still works'
    )
  }

  // ---- auto ----
  // Priority: Groq → xAI Grok → Ollama

  const tryGroq = (): ResolveProviderResult | null => {
    if (!(settings.groqEnabled && hasGroqKey)) return null
    if (groq.ok && groqModel) {
      return build('groq', groqModel, `Groq ready (${groqModel})`)
    }
    return null // hard failure → fall through
  }

  const tryGrok = (): ResolveProviderResult | null => {
    if (!(settings.grokEnabled && hasKey)) return null
    if (grok.ok && grokModel) {
      return build('grok', grokModel, `Grok ready (${grokModel})`)
    }
    return null
  }

  const tryOllama = (): ResolveProviderResult | null => {
    if (ollama.ok && ollamaModel) {
      return build('ollama', ollamaModel, 'Ollama ready')
    }
    return null
  }

  const groqHit = tryGroq()
  if (groqHit) return groqHit

  const grokHit = tryGrok()
  if (grokHit) return grokHit

  const ollamaHit = tryOllama()
  if (ollamaHit) return ollamaHit

  // Surface useful errors when cloud toggles are on but nothing worked
  if (settings.groqEnabled && !hasGroqKey && !settings.grokEnabled) {
    return build(null, null, 'Groq enabled but no API key')
  }
  if (settings.grokEnabled && !hasKey && !settings.groqEnabled) {
    return build(null, null, 'Grok enabled but no API key')
  }
  if (settings.groqEnabled && hasGroqKey && !groq.ok && groq.error) {
    if (!(settings.grokEnabled && hasKey)) {
      return build(
        null,
        null,
        groq.error === 'No Groq API key'
          ? 'Groq enabled but no API key'
          : `Groq error: ${groq.error}`
      )
    }
  }
  if (settings.grokEnabled && hasKey && !grok.ok && grok.error) {
    return build(
      null,
      null,
      grok.error === 'No xAI API key'
        ? 'Grok enabled but no API key'
        : `Grok error: ${grok.error}`
    )
  }
  if (
    (settings.groqEnabled && !hasGroqKey) ||
    (settings.grokEnabled && !hasKey)
  ) {
    // Both/either toggled without keys and Ollama down
    if (settings.groqEnabled && !hasGroqKey) {
      return build(null, null, 'Groq enabled but no API key')
    }
    return build(null, null, 'Grok enabled but no API key')
  }

  if (ollama.ok && !ollamaModel) {
    return build(null, null, 'Ollama reachable but no models installed')
  }
  return build(null, null, 'AI offline — search still works')
}

export async function resolveProvider(): Promise<ResolveProviderResult> {
  const settings = getLlmSettings()
  const hasKey = hasXaiApiKey()
  const hasGroqKey = hasGroqApiKey()

  const needGrok =
    settings.provider === 'grok' ||
    (settings.provider === 'auto' && settings.grokEnabled) ||
    settings.grokEnabled

  const needGroq =
    settings.provider === 'groq' ||
    (settings.provider === 'auto' && settings.groqEnabled) ||
    settings.groqEnabled

  const needOllama =
    settings.provider === 'ollama' ||
    settings.provider === 'auto' ||
    (settings.provider === 'grok' || settings.provider === 'groq' ? false : true)

  const [ollama, grok, groq] = await Promise.all([
    needOllama || settings.provider === 'auto'
      ? ollamaHealth()
      : Promise.resolve({ ok: false, error: 'skipped' } as OllamaHealth),
    needGrok || hasKey
      ? grokHealth()
      : Promise.resolve({
          ok: false,
          hasKey: false,
          error: 'No xAI API key',
        } as GrokHealth),
    needGroq || hasGroqKey
      ? groqHealth()
      : Promise.resolve({
          ok: false,
          hasKey: false,
          error: 'No Groq API key',
        } as GroqHealth),
  ])

  // When provider is forced cloud, still report ollama health for status panel
  const ollamaForStatus =
    settings.provider === 'grok' || settings.provider === 'groq'
      ? await ollamaHealth().catch(() => ollama)
      : ollama

  return resolveProviderFromHealth({
    settings,
    hasKey,
    hasGroqKey,
    ollama: ollamaForStatus,
    grok: { ...grok, hasKey },
    groq: { ...groq, hasKey: hasGroqKey },
  })
}

async function tryOllamaFallback(
  prompt: string
): Promise<
  | { ok: true; text: string; provider: 'ollama'; model: string }
  | { ok: false; error: string; provider: 'ollama' }
  | null
> {
  const oh = await ollamaHealth()
  const om = oh.ok ? pickModel(oh.models ?? []) : null
  if (!om) return null
  const fallback = await ollamaGenerate(om, prompt)
  if (fallback.ok) {
    return { ok: true, text: fallback.text, provider: 'ollama', model: om }
  }
  return { ok: false, error: fallback.error, provider: 'ollama' }
}

async function tryGrokFallback(
  prompt: string,
  settings: LlmSettings
): Promise<
  | { ok: true; text: string; provider: 'grok'; model: string }
  | { ok: false; error: string; provider: 'grok' }
  | null
> {
  if (!(settings.grokEnabled && hasXaiApiKey())) return null
  const gh = await grokHealth()
  const model = gh.ok ? (gh.models?.[0] ?? settings.grokModel) : settings.grokModel
  if (!model) return null
  const gen = await grokGenerate(model, prompt)
  if (gen.ok) {
    return { ok: true, text: gen.text, provider: 'grok', model }
  }
  return { ok: false, error: gen.error, provider: 'grok' }
}

export async function llmGenerate(
  prompt: string
): Promise<
  | { ok: true; text: string; provider: LlmProviderId; model: string }
  | { ok: false; error: string; provider?: LlmProviderId | null }
> {
  const resolved = await resolveProvider()
  if (!resolved.provider || !resolved.model) {
    return {
      ok: false,
      error: resolved.status.message,
      provider: resolved.provider,
    }
  }

  const { provider, model } = resolved
  const settings = getLlmSettings()

  if (provider === 'groq') {
    const gen = await groqGenerate(model, prompt)
    if (!gen.ok) {
      // Auto fallback: Groq → Grok → Ollama
      if (settings.provider === 'auto') {
        const grokFb = await tryGrokFallback(prompt, settings)
        if (grokFb?.ok) return grokFb
        const ollamaFb = await tryOllamaFallback(prompt)
        if (ollamaFb) return ollamaFb
      }
      return { ok: false, error: gen.error, provider: 'groq' }
    }
    return { ok: true, text: gen.text, provider: 'groq', model }
  }

  if (provider === 'grok') {
    const gen = await grokGenerate(model, prompt)
    if (!gen.ok) {
      // Auto fallback: Grok → Ollama (Groq already preferred above if enabled)
      if (settings.provider === 'auto') {
        const ollamaFb = await tryOllamaFallback(prompt)
        if (ollamaFb) return ollamaFb
      }
      return { ok: false, error: gen.error, provider: 'grok' }
    }
    return { ok: true, text: gen.text, provider: 'grok', model }
  }

  const gen = await ollamaGenerate(model, prompt)
  if (!gen.ok) {
    return { ok: false, error: gen.error, provider: 'ollama' }
  }
  return { ok: true, text: gen.text, provider: 'ollama', model }
}

/** Human label for offline / error copy */
export function providerDisplayName(provider: LlmProviderId | null | undefined): string {
  if (provider === 'groq') return 'Groq'
  if (provider === 'grok') return 'Grok'
  if (provider === 'ollama') return 'Ollama'
  return 'AI'
}
