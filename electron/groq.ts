/**
 * OpenAI-compatible GroqCloud Chat Completions client.
 * Base URL: LKV_GROQ_BASE_URL or https://api.groq.com/openai/v1
 * (Groq ≠ xAI Grok — different vendor / API.)
 * Never log the API key.
 */
import { getLlmSettings, getGroqApiKey, hasGroqApiKey } from './llm-settings'

const DEFAULT_BASE = 'https://api.groq.com/openai/v1'
const HEALTH_TIMEOUT_MS = 8000
const GENERATE_TIMEOUT_MS = 120_000

export interface GroqHealth {
  ok: boolean
  models?: string[]
  error?: string
  hasKey: boolean
}

function baseUrl(): string {
  const env = process.env.LKV_GROQ_BASE_URL?.trim()
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

/** Prefer configured, then first llama* / openai* / gpt-oss* from listed ids. */
export function orderGroqModels(ids: string[], configured: string): string[] {
  const preferredRe = /^(llama|openai|gpt-oss)/i
  const uniq = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))]
  const rest = uniq.filter((id) => id !== configured)
  const preferred = rest.filter((id) => preferredRe.test(id))
  const other = rest.filter((id) => !preferredRe.test(id))
  return [configured, ...preferred, ...other]
}

export async function groqHealth(): Promise<GroqHealth> {
  const hasKey = hasGroqApiKey()
  if (!hasKey) {
    return { ok: false, hasKey: false, error: 'No Groq API key' }
  }

  const settings = getLlmSettings()
  const modelList = [settings.groqModel]

  // Optional models probe — soft-fail to configured model if endpoint unavailable
  try {
    const key = getGroqApiKey()
    if (!key) {
      return { ok: false, hasKey: false, error: 'No Groq API key' }
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
        return { ok: true, hasKey: true, models: orderGroqModels(ids, settings.groqModel) }
      }
    }
    // Non-OK or empty — still report ready with configured model (key present)
    return { ok: true, hasKey: true, models: modelList }
  } catch {
    // Network/timeout — key is present; treat as ready with configured model
    return { ok: true, hasKey: true, models: modelList }
  }
}

export async function groqGenerate(
  model: string,
  prompt: string
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const key = getGroqApiKey()
  if (!key) {
    return { ok: false, error: 'No Groq API key' }
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
      let detail = `Groq HTTP ${res.status}`
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
