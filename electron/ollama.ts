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

export async function ollamaHealth(
  baseUrl: string = ollamaBaseUrl(),
  apiKey?: string | null
): Promise<OllamaHealth> {
  try {
    const headers: Record<string, string> = {}
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    const res = await fetchWithTimeout(
      joinUrl(baseUrl, '/api/tags'),
      Object.keys(headers).length ? { headers } : undefined,
      HEALTH_TIMEOUT_MS
    )
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

const MIN_NUM_CTX = 2048
const MAX_NUM_CTX = 8192

/**
 * Estimate the context window (`num_ctx`) a request needs. Ollama's default
 * context silently truncates the leading system/rules once a chat grows, so we
 * size num_ctx from the prompt plus room for the answer, within sane bounds.
 * Rough heuristic: ~4 characters per token.
 */
export function estimateNumCtx(
  system: string | undefined,
  prompt: string,
  maxTokens?: number
): number {
  const inputChars = (system?.length ?? 0) + prompt.length
  const inputTokens = Math.ceil(inputChars / 4)
  const outputTokens = maxTokens ?? 512
  return Math.min(Math.max(inputTokens + outputTokens, MIN_NUM_CTX), MAX_NUM_CTX)
}

/**
 * Read an Ollama `/api/generate` NDJSON stream (`stream: true`), concatenating
 * `response` chunks and skipping `thinking` chunks so reasoning tokens never
 * leak into the answer regardless of `<think>` tag handling. The final chunk
 * carries `done_reason` — `"length"` means the output-token limit cut the
 * reply off, which structured callers must treat as ran-out-of-tokens (#275).
 */
export async function readOllamaStreamDetailed(
  res: Response
): Promise<{ text: string; doneReason?: string }> {
  const body = res.body
  if (!body) return { text: '' }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let out = ''
  let doneReason: string | undefined
  let buffer = ''
  const absorb = (line: string): void => {
    if (!line) return
    try {
      const chunk = JSON.parse(line) as { response?: string; done?: boolean; done_reason?: string }
      if (chunk.response) out += chunk.response
      if (chunk.done && chunk.done_reason) doneReason = chunk.done_reason
    } catch {
      /* ignore a malformed/partial line */
    }
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl = buffer.indexOf('\n')
    while (nl >= 0) {
      absorb(buffer.slice(0, nl).trim())
      buffer = buffer.slice(nl + 1)
      nl = buffer.indexOf('\n')
    }
  }
  absorb((buffer + decoder.decode()).trim())
  return { text: out, doneReason }
}

/** Text-only view of `readOllamaStreamDetailed` (existing callers/tests). */
export async function readOllamaStream(res: Response): Promise<string> {
  return (await readOllamaStreamDetailed(res)).text
}

export async function ollamaGenerate(
  model: string,
  input: GenerateInput | string,
  baseUrl: string = ollamaBaseUrl(),
  apiKey?: string | null
): Promise<GenerateResult> {
  const req = typeof input === 'string' ? { prompt: input } : input
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    const res = await fetchWithTimeout(
      joinUrl(baseUrl, '/api/generate'),
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          prompt: req.prompt,
          ...(req.system ? { system: req.system } : {}),
          stream: true,
          // qwen3 (first-preference model) thinks by default; disable it so it
          // answers instead of burning the timeout in <think> reasoning (#36).
          think: false,
          options: {
            temperature: 0.2,
            num_ctx: estimateNumCtx(req.system, req.prompt, req.maxTokens),
            ...(req.maxTokens ? { num_predict: req.maxTokens } : {}),
          },
        }),
      },
      req.timeoutMs ?? 180_000
    )
    if (!res.ok) {
      return { ok: false, error: await readErrorDetail(res, 'Ollama') }
    }
    const { text: raw, doneReason } = await readOllamaStreamDetailed(res)
    const text = stripThinking(raw)
    // done_reason "length" = num_predict cut the reply off (#275).
    return { ok: true, text, truncated: doneReason === 'length' }
  } catch (err) {
    return { ok: false, error: errMessage(err) }
  }
}
