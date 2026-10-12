/**
 * Generic OpenAI-compatible adapter:
 *   GET  {baseUrl}/models
 *   POST {baseUrl}/chat/completions   (Authorization: Bearer <key> — optional for local servers)
 * Used by LM Studio, OpenAI, OpenRouter, Mistral, DeepSeek, Together, Groq, xAI, Gemini (OpenAI
 * endpoint) and any custom URL (vLLM, llama.cpp server, LocalAI …). Never logs the key.
 */
import {
  errMessage,
  fetchWithTimeout,
  isReasoningModel,
  joinUrl,
  readErrorDetail,
  stripThinking,
  type GenerateInput,
  type GenerateResult,
} from './http'

export interface OpenAiTarget {
  baseUrl: string
  apiKey?: string | null
  /** Label used in error messages ("OpenAI", "LM Studio" …). */
  label?: string
  extraHeaders?: Record<string, string>
}

function headers(t: OpenAiTarget, json: boolean): Record<string, string> {
  const h: Record<string, string> = { ...(t.extraHeaders ?? {}) }
  if (json) h['Content-Type'] = 'application/json'
  if (t.apiKey) h.Authorization = `Bearer ${t.apiKey}`
  return h
}

export async function openAiListModels(
  t: OpenAiTarget,
  timeoutMs = 6000
): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  try {
    const res = await fetchWithTimeout(
      joinUrl(t.baseUrl, '/models'),
      { method: 'GET', headers: headers(t, false) },
      timeoutMs
    )
    if (!res.ok) return { ok: false, error: await readErrorDetail(res, t.label ?? 'Provider') }
    const data = (await res.json()) as { data?: Array<{ id?: string }>; models?: Array<{ id?: string; name?: string }> }
    const rows = data.data ?? data.models ?? []
    const models = rows
      .map((m) => m.id ?? (m as { name?: string }).name)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    return { ok: true, models: [...new Set(models)] }
  } catch (err) {
    return { ok: false, error: errMessage(err) }
  }
}

/** Build the request body. Exported for tests. */
export function buildOpenAiChatBody(
  model: string,
  input: GenerateInput,
  opts: { temperature?: number | null } = {}
): Record<string, unknown> {
  const messages: Array<{ role: string; content: string }> = []
  if (input.system) messages.push({ role: 'system', content: input.system })
  messages.push({ role: 'user', content: input.prompt })
  const body: Record<string, unknown> = { model, messages, stream: false }
  const temp = opts.temperature === undefined ? 0.2 : opts.temperature
  if (temp !== null) body.temperature = temp
  if (input.maxTokens) body.max_tokens = input.maxTokens
  // Structured calls to reasoning models ask for low reasoning effort so the
  // budget is spent on the answer, not the thinking (#275). Only reasoning
  // families get the parameter — others reject unknown fields.
  if (input.reasoningEffort && isReasoningModel(model)) body.reasoning_effort = input.reasoningEffort
  return body
}

async function postChat(t: OpenAiTarget, body: Record<string, unknown>, timeoutMs: number) {
  return fetchWithTimeout(
    joinUrl(t.baseUrl, '/chat/completions'),
    { method: 'POST', headers: headers(t, true), body: JSON.stringify(body) },
    timeoutMs
  )
}

export async function openAiChat(
  t: OpenAiTarget,
  model: string,
  input: GenerateInput
): Promise<GenerateResult> {
  const timeoutMs = input.timeoutMs ?? 180_000
  try {
    let body = buildOpenAiChatBody(model, input)
    let res = await postChat(t, body, timeoutMs)
    if (!res.ok && res.status === 400) {
      // Some models (e.g. reasoning families) reject custom temperature /
      // max_tokens / reasoning_effort — retry plain (#275).
      const detail = await readErrorDetail(res, t.label ?? 'Provider')
      if (/temperature|max_tokens|reasoning_effort|unsupported (parameter|value)/i.test(detail)) {
        body = buildOpenAiChatBody(
          model,
          { ...input, maxTokens: undefined, reasoningEffort: undefined },
          { temperature: null },
        )
        res = await postChat(t, body, timeoutMs)
      } else {
        return { ok: false, error: detail }
      }
    }
    if (!res.ok) return { ok: false, error: await readErrorDetail(res, t.label ?? 'Provider') }
    const data = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string | Array<{ type?: string; text?: string }> }
        finish_reason?: string | null
      }>
    }
    const choice = data.choices?.[0]
    const content = choice?.message?.content
    const text = Array.isArray(content)
      ? content.map((c) => c.text ?? '').join('')
      : (content ?? '')
    // A "length" finish means the output-token limit was hit — reasoning models
    // can spend the whole budget thinking and leave nothing for the answer (#275).
    const truncated = choice?.finish_reason === 'length'
    return { ok: true, text: stripThinking(text), truncated }
  } catch (err) {
    return { ok: false, error: errMessage(err) }
  }
}
