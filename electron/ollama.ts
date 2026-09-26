/**
 * Ollama adapter (native API): GET /api/tags, POST /api/generate.
 * Base URL: provider config → LKV_OLLAMA_URL → http://127.0.0.1:11434
 */
import type { OllamaHealth } from './types'
import { ollamaBaseUrl, isSmallModel, isCloudModel } from './providers/presets'
import {
  errMessage,
  fetchWithTimeout,
  joinUrl,
  readErrorDetail,
  stripThinking,
  type GenerateInput,
  type GenerateResult,
} from './providers/http'

const HEALTH_TIMEOUT_MS = 4000

export async function ollamaHealth(baseUrl: string = ollamaBaseUrl()): Promise<OllamaHealth> {
  try {
    const res = await fetchWithTimeout(joinUrl(baseUrl, '/api/tags'), undefined, HEALTH_TIMEOUT_MS)
    if (!res.ok) {
      return { ok: false, error: `Ollama HTTP ${res.status}` }
    }
    const data = (await res.json()) as {
      models?: Array<{ name: string; details?: { parameter_size?: string; family?: string } }>
    }
    const list = data.models ?? []
    const models = list.map((m) => m.name)
    const modelSizes: Record<string, string> = {}
    for (const m of list) {
      if (m.details?.parameter_size) modelSizes[m.name] = m.details.parameter_size
    }
    return { ok: true, models, modelSizes }
  } catch (err) {
    return { ok: false, error: errMessage(err) }
  }
}

function isEmbeddingModel(name: string): boolean {
  return /embed|bge-|nomic-embed|minilm|rerank/i.test(name)
}

/**
 * Prefer env override, then non-embedding, non-cloud, not-tiny models; among those
 * qwen3 / llama3.x, then the first available. Tiny models are still used when nothing
 * bigger is installed. Cloud models (`:cloud` / `-cloud`) are never auto-picked — they
 * run on ollama.com, not locally.
 */
export function pickModel(models: string[], sizes: Record<string, string> = {}): string | null {
  const envModel = process.env.LKV_OLLAMA_MODEL
  if (envModel) return envModel
  const chat = models.filter((m) => !isEmbeddingModel(m) && !isCloudModel(m))
  if (!chat.length) return null
  const big = chat.filter((m) => !isSmallModel(m, sizes[m]))
  const pool = big.length ? big : chat
  const prefs = [/^qwen3/i, /^llama3\.2/i, /^llama3/i, /llama/i, /^gemma3/i, /^mistral/i]
  for (const re of prefs) {
    const hit = pool.find((m) => re.test(m))
    if (hit) return hit
  }
  return pool[0]
}

export async function ollamaGenerate(
  model: string,
  input: GenerateInput | string,
  baseUrl: string = ollamaBaseUrl()
): Promise<GenerateResult> {
  const req = typeof input === 'string' ? { prompt: input } : input
  try {
    const res = await fetchWithTimeout(
      joinUrl(baseUrl, '/api/generate'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: req.prompt,
          ...(req.system ? { system: req.system } : {}),
          stream: false,
          options: {
            temperature: 0.2,
            ...(req.maxTokens ? { num_predict: req.maxTokens } : {}),
          },
        }),
      },
      req.timeoutMs ?? 180_000
    )
    if (!res.ok) {
      return { ok: false, error: await readErrorDetail(res, 'Ollama') }
    }
    const data = (await res.json()) as { response?: string }
    return { ok: true, text: stripThinking(data.response ?? '') }
  } catch (err) {
    return { ok: false, error: errMessage(err) }
  }
}
