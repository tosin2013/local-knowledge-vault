/**
 * OpenAI-compatible Grok / xAI Chat Completions client.
 * Base URL: LKV_XAI_BASE_URL or https://api.x.ai/v1
 * Never log the API key.
 */
import { getLlmSettings, getXaiApiKey, hasXaiApiKey } from './llm-settings'

const DEFAULT_BASE = 'https://api.x.ai/v1'
const HEALTH_TIMEOUT_MS = 8000
const GENERATE_TIMEOUT_MS = 120_000

export interface GrokHealth {
  ok: boolean
  models?: string[]
  error?: string
  hasKey: boolean
}

function baseUrl(): string {
  const env = process.env.LKV_XAI_BASE_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  return DEFAULT_BASE
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = HEALTH_TIMEOUT_MS
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function grokHealth(): Promise<GrokHealth> {
  const hasKey = hasXaiApiKey()
  if (!hasKey) {
    return { ok: false, hasKey: false, error: 'No xAI API key' }
  }

  const settings = getLlmSettings()
  const modelList = [settings.grokModel]

  // Optional models probe — soft-fail to configured model if endpoint unavailable
  try {
    const key = getXaiApiKey()
    if (!key) {
      return { ok: false, hasKey: false, error: 'No xAI API key' }
    }
    const res = await fetchWithTimeout(`${baseUrl()}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    })
    if (res.ok) {
      const data = (await res.json()) as { data?: Array<{ id?: string }> }
      const ids = (data.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
      if (ids.length > 0) {
        // Prefer configured model; include it even if not listed
        const models = ids.includes(settings.grokModel)
          ? ids
          : [settings.grokModel, ...ids]
        return { ok: true, hasKey: true, models }
      }
    }
    // Non-OK or empty — still report ready with configured model (key present)
    return { ok: true, hasKey: true, models: modelList }
  } catch {
    // Network/timeout — key is present; treat as ready with configured model
    return { ok: true, hasKey: true, models: modelList }
  }
}

export async function grokGenerate(
  model: string,
  prompt: string
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const key = getXaiApiKey()
  if (!key) {
    return { ok: false, error: 'No xAI API key' }
  }

  try {
    const res = await fetchWithTimeout(
      `${baseUrl()}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
        }),
      },
      GENERATE_TIMEOUT_MS
    )

    if (!res.ok) {
      let detail = `Grok HTTP ${res.status}`
      try {
        const errBody = (await res.json()) as { error?: { message?: string } | string }
        if (typeof errBody.error === 'string') detail = errBody.error
        else if (errBody.error?.message) detail = errBody.error.message
      } catch {
        /* ignore body parse */
      }
      return { ok: false, error: detail }
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const text = data.choices?.[0]?.message?.content ?? ''
    return { ok: true, text }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}
