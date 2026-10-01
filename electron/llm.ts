/**
 * Provider registry router. Every generation path (Ask, Chat, Media chat, personas, URL auto-tag,
 * Bridge) goes through llmGenerate → the same grounded prompt regardless of provider.
 *
 * Auto (default, local-first):
 *   1. Ollama (enabled + reachable + a chat model installed)
 *   2. LM Studio (OpenAI-compatible server at :1234, models via /v1/models)
 *   3. Other enabled local providers (custom localhost URLs)
 *   4. Enabled cloud providers (only ones the user added/enabled, with a key) in list order
 * Auto, local only ('auto-local'): steps 1–3, never a cloud provider (#45).
 * Explicit selection uses that provider only (no silent fallback to something else).
 */
import { ollamaGenerate, ollamaHealth, pickModel } from './ollama'
import { openAiChat, openAiListModels } from './providers/openai-compatible'
import { anthropicChat, anthropicListModels } from './providers/anthropic'
import type { GenerateInput, GenerateResult } from './providers/http'
import { RECOMMENDED_LOCAL_MODEL, isSmallModel, isCloudModel, getBuiltinPreset } from './providers/presets'
import {
  getProviderConfig,
  getProviderKey,
  getSelection,
  isAutoSelection,
  listProviderConfigs,
} from './provider-store'
import type {
  ActiveProviderInfo,
  LlmStatus,
  ProviderConfig,
  ProviderDraft,
  ProviderHealth,
  ProviderModelsResult,
  ProviderSelection,
  ProviderTestResult,
} from './types'

export type { GenerateInput } from './providers/http'

export interface ResolvedCandidate {
  provider: ProviderConfig
  model: string
}

export interface ResolveResult {
  candidates: ResolvedCandidate[]
  status: LlmStatus
}

/** Resolve a provider's key for a call (main process only). */
function keyFor(p: Pick<ProviderConfig, 'id' | 'presetId'>): string | null {
  return getProviderKey(p.id, p.presetId)
}

function isEmbeddingModel(name: string): boolean {
  return /embed|bge-|nomic-embed|minilm|rerank|whisper|tts/i.test(name)
}

/** Model to use given config + health. Local empty model = auto-pick installed. Pure. */
export function effectiveModel(p: ProviderConfig, health?: ProviderHealth): string | null {
  if (p.model) return p.model
  if (!p.local) return null
  const models = health?.models ?? []
  if (p.kind === 'ollama') return pickModel(models, health?.modelSizes ?? {})
  return models.find((m) => !isEmbeddingModel(m)) ?? null
}

/** A provider is "ready" when it can be called right now. Pure. */
export function providerReadiness(p: ProviderConfig): { ready: boolean; model: string | null; reason: string } {
  const model = effectiveModel(p, p.health)
  if (!p.enabled) return { ready: false, model, reason: `${p.label} is turned off` }
  if (p.local) {
    if (!p.health?.ok) return { ready: false, model, reason: `${p.label} not running${p.health?.error ? ` (${p.health.error})` : ''}` }
    if (!model) return { ready: false, model, reason: `${p.label} is running but has no models installed` }
    return { ready: true, model, reason: `${p.label} ready` }
  }
  if (p.requiresKey && !p.hasKey) return { ready: false, model, reason: `${p.label} needs an API key` }
  if (!model) return { ready: false, model, reason: `${p.label} has no model set` }
  return { ready: true, model, reason: `${p.label} ready` }
}

function activeInfo(c: ResolvedCandidate): ActiveProviderInfo {
  const size = c.provider.health?.modelSizes?.[c.model]
  const local = c.provider.local && !isCloudModel(c.model)
  return {
    id: c.provider.id,
    label: c.provider.label,
    kind: c.provider.kind,
    local,
    model: c.model,
    smallModel: local ? isSmallModel(c.model, size) : false,
  }
}

/** Pure resolution from providers-with-health. Unit-testable without network. */
export function resolveFromProviders(selected: ProviderSelection, providers: ProviderConfig[]): ResolveResult {
  const base = { selected, providers, recommendedLocalModel: RECOMMENDED_LOCAL_MODEL }
  if (!isAutoSelection(selected)) {
    const p = providers.find((x) => x.id === selected)
    if (!p) {
      return {
        candidates: [],
        status: { ...base, active: null, needsSetup: false, message: `Selected provider "${selected}" not found — pick another in AI providers` },
      }
    }
    const r = providerReadiness(p)
    if (r.ready && r.model) {
      const c = { provider: p, model: r.model }
      return { candidates: [c], status: { ...base, active: activeInfo(c), needsSetup: false, message: `${p.label} ready (${r.model})` } }
    }
    return { candidates: [], status: { ...base, active: null, needsSetup: false, message: `${r.reason} — search still works` } }
  }

  const localOnly = selected === 'auto-local'
  const locals = providers.filter((p) => p.local)
  const clouds = localOnly ? [] : providers.filter((p) => !p.local)
  const candidates: ResolvedCandidate[] = []
  for (const p of [...locals, ...clouds]) {
    const r = providerReadiness(p)
    if (r.ready && r.model) candidates.push({ provider: p, model: r.model })
  }
  if (candidates.length) {
    const c = candidates[0]
    const ai = activeInfo(c)
    return {
      candidates,
      status: {
        ...base,
        active: ai,
        needsSetup: false,
        message: `${ai.local ? 'Local' : 'Cloud'} · ${c.provider.label} · ${c.model}`,
      },
    }
  }
  const runningNoModels = locals.find((p) => p.enabled && p.health?.ok && !effectiveModel(p, p.health))
  const cloudEnabled = clouds.some((p) => p.enabled)
  let message = localOnly
    ? 'No local model detected — start Ollama or LM Studio. Auto is set to local only, so cloud providers are not used (search still works)'
    : 'No local model detected — start Ollama or LM Studio (search still works)'
  if (runningNoModels) {
    message =
      runningNoModels.kind === 'ollama'
        ? `Ollama is running but has no models — run: ${RECOMMENDED_LOCAL_MODEL.command}`
        : `${runningNoModels.label} is running but no model is loaded`
  } else if (cloudEnabled) {
    const p = clouds.find((x) => x.enabled)!
    message = `${providerReadiness(p).reason} — search still works`
  }
  return { candidates: [], status: { ...base, active: null, needsSetup: !cloudEnabled, message } }
}

/** Probe health. Local providers are pinged; cloud providers are not (no network per status poll). */
export async function probeHealth(p: ProviderConfig, keyOverride?: string | null): Promise<ProviderHealth> {
  if (!p.local) {
    return { ok: p.hasKey || !p.requiresKey, skipped: true }
  }
  if (!p.enabled) return { ok: false, skipped: true, error: 'disabled' }
  if (p.kind === 'ollama') {
    const h = await ollamaHealth(p.baseUrl)
    return { ok: h.ok, models: h.models, modelSizes: h.modelSizes, error: h.error }
  }
  const r = await openAiListModels(
    { baseUrl: p.baseUrl, apiKey: keyOverride ?? keyFor(p), label: p.label },
    2500
  )
  return r.ok ? { ok: true, models: r.models } : { ok: false, error: r.error }
}

export async function resolveProvider(): Promise<ResolveResult> {
  const providers = listProviderConfigs()
  const withHealth = await Promise.all(
    providers.map(async (p) => ({ ...p, health: await probeHealth(p) }))
  )
  return resolveFromProviders(getSelection(), withHealth)
}

/** Dispatch one call to a provider by kind. */
export async function generateWith(
  p: Pick<ProviderConfig, 'id' | 'presetId' | 'kind' | 'baseUrl' | 'label'>,
  model: string,
  input: GenerateInput,
  keyOverride?: string | null
): Promise<GenerateResult> {
  const apiKey = keyOverride !== undefined ? keyOverride : keyFor(p)
  switch (p.kind) {
    case 'ollama':
      return ollamaGenerate(model, input, p.baseUrl)
    case 'anthropic':
      return anthropicChat({ baseUrl: p.baseUrl, apiKey }, model, input)
    case 'gemini':
    case 'openai-compatible':
    default:
      return openAiChat({ baseUrl: p.baseUrl, apiKey, label: p.label }, model, input)
  }
}

export type LlmGenerateResult =
  | {
      ok: true
      text: string
      provider: string
      providerLabel: string
      /** False when the request left this computer (cloud provider or an Ollama `:cloud` model). */
      local: boolean
      model: string
      /** True when Auto picked a cloud provider because no local model answered (#45). */
      fallback: boolean
    }
  | { ok: false; error: string; provider?: string | null; providerLabel?: string }

/**
 * Generate text through the registry. In Auto, a hard failure falls through to the next
 * ready provider (local first). The prompt/grounding is identical for every provider.
 * The result says whether the answer stayed local, so callers can flag cloud answers.
 */
export async function llmGenerate(input: GenerateInput | string): Promise<LlmGenerateResult> {
  const req: GenerateInput = typeof input === 'string' ? { prompt: input } : input
  const resolved = await resolveProvider()
  if (!resolved.candidates.length) {
    return { ok: false, error: resolved.status.message, provider: null }
  }
  let lastErr: { error: string; provider: string; providerLabel: string } | null = null
  for (const c of resolved.candidates) {
    const gen = await generateWith(c.provider, c.model, req)
    if (gen.ok) {
      const local = c.provider.local && !isCloudModel(c.model)
      return {
        ok: true,
        text: gen.text,
        provider: c.provider.id,
        providerLabel: c.provider.label,
        local,
        model: c.model,
        fallback: !local && resolved.status.selected === 'auto',
      }
    }
    lastErr = { error: gen.error, provider: c.provider.id, providerLabel: c.provider.label }
  }
  return { ok: false, ...lastErr! }
}

/** Build a transient config from a draft (for Test connection / Fetch models before saving). */
function draftToConfig(d: ProviderDraft): ProviderConfig {
  const existing = d.id ? getProviderConfig(d.id) : undefined
  return {
    id: d.id ?? 'draft',
    kind: d.kind,
    label: d.label || existing?.label || 'Provider',
    baseUrl: d.baseUrl.trim().replace(/\/+$/, ''),
    model: d.model.trim(),
    hasKey: !!existing?.hasKey,
    requiresKey: false,
    local: d.local ?? existing?.local ?? false,
    enabled: true,
    source: existing?.source ?? 'user',
    presetId: d.presetId ?? existing?.presetId,
  }
}

/** The base URL a stored key is tied to: the saved provider's, or the preset default. */
function trustedBaseUrl(d: ProviderDraft): string | null {
  const existing = d.id ? getProviderConfig(d.id) : undefined
  if (existing) return existing.baseUrl.replace(/\/+$/, '')
  const preset = d.presetId ? getBuiltinPreset(d.presetId) : undefined
  return preset ? preset.baseUrl.replace(/\/+$/, '') : null
}

function draftKey(d: ProviderDraft, cfg: ProviderConfig): string | null {
  if (typeof d.apiKey === 'string' && d.apiKey.trim()) return d.apiKey.trim()
  if (d.apiKey === null) return null
  // Blank field: reuse the saved/env key ONLY when the draft baseUrl still points at the
  // provider's known base URL (saved or preset default). Otherwise the key would be sent to
  // an arbitrary URL, breaking the write-only-keys guarantee.
  const trusted = trustedBaseUrl(d)
  if (trusted && cfg.baseUrl !== trusted) return null
  return keyFor(cfg)
}

export async function fetchProviderModels(d: ProviderDraft): Promise<ProviderModelsResult> {
  const cfg = draftToConfig(d)
  const key = draftKey(d, cfg)
  if (cfg.kind === 'ollama') {
    const h = await ollamaHealth(cfg.baseUrl)
    return h.ok ? { ok: true, models: h.models ?? [] } : { ok: false, models: [], error: h.error }
  }
  if (cfg.kind === 'anthropic') {
    const r = await anthropicListModels({ baseUrl: cfg.baseUrl, apiKey: key })
    return r.ok ? { ok: true, models: r.models } : { ok: false, models: [], error: r.error }
  }
  const r = await openAiListModels({ baseUrl: cfg.baseUrl, apiKey: key, label: cfg.label }, 8000)
  return r.ok
    ? { ok: true, models: r.models.filter((m) => !isEmbeddingModel(m)).sort() }
    : { ok: false, models: [], error: r.error }
}

export const TEST_PROMPT = 'Reply with exactly: OK'

/** Send a tiny prompt; report latency or the exact error. Never returns the key. */
export async function testProvider(d: ProviderDraft): Promise<ProviderTestResult> {
  const cfg = draftToConfig(d)
  const key = draftKey(d, cfg)
  let model = cfg.model
  const t0 = Date.now()
  if (!model) {
    const health = await probeHealth({ ...cfg, local: true }, key)
    model = effectiveModel({ ...cfg, local: true }, health) ?? ''
    if (!model) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        error: health.ok ? 'Server reachable, but no model is installed/loaded — pick or type a model' : (health.error ?? 'Not reachable'),
      }
    }
  }
  const gen = await generateWith(cfg, model, { prompt: TEST_PROMPT, timeoutMs: 60_000 }, key)
  const latencyMs = Date.now() - t0
  if (!gen.ok) return { ok: false, latencyMs, model, error: gen.error }
  return { ok: true, latencyMs, model, sample: gen.text.slice(0, 80) }
}

/** Human label for offline / error copy */
export function providerDisplayName(providerId: string | null | undefined, label?: string): string {
  if (label) return label
  if (!providerId) return 'AI'
  return getProviderConfig(providerId)?.label ?? providerId
}
