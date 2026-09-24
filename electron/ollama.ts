/**
 * Minimal Ollama HTTP client (localhost:11434).
 * Cloud provider stubs intentionally omitted — keep local-only for MVP.
 * // Future: CloudProvider interface could wrap OpenAI/Anthropic; not in MVP.
 */
import type { OllamaHealth } from './types'

const OLLAMA_BASE = process.env.LKV_OLLAMA_URL ?? 'http://127.0.0.1:11434'
const FETCH_TIMEOUT_MS = 4000

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function ollamaHealth(): Promise<OllamaHealth> {
  try {
    const res = await fetchWithTimeout(`${OLLAMA_BASE}/api/tags`)
    if (!res.ok) {
      return { ok: false, error: `Ollama HTTP ${res.status}` }
    }
    const data = (await res.json()) as { models?: Array<{ name: string }> }
    const models = (data.models ?? []).map((m) => m.name)
    return { ok: true, models }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}

/** Prefer env override, then llama3.2*, then first available model */
export function pickModel(models: string[]): string | null {
  const envModel = process.env.LKV_OLLAMA_MODEL
  if (envModel) return envModel
  if (!models.length) return null
  const preferred = models.find((m) => /^llama3\.2/i.test(m))
  if (preferred) return preferred
  const llama = models.find((m) => /llama/i.test(m))
  if (llama) return llama
  return models[0]
}

export async function ollamaGenerate(
  model: string,
  prompt: string
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const res = await fetchWithTimeout(
      `${OLLAMA_BASE}/api/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { temperature: 0.2 },
        }),
      },
      120_000
    )
    if (!res.ok) {
      return { ok: false, error: `Ollama generate HTTP ${res.status}` }
    }
    const data = (await res.json()) as { response?: string }
    return { ok: true, text: data.response ?? '' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}
