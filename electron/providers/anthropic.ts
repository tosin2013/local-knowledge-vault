/**
 * Native Anthropic Messages API adapter.
 *   POST {baseUrl}/messages   headers: x-api-key, anthropic-version: 2023-06-01
 *   GET  {baseUrl}/models
 * The grounding rules go in the top-level `system` field; the user turn carries passages.
 * No temperature is sent (newer Claude models reject non-default sampling params).
 */
import {
  errMessage,
  fetchWithTimeout,
  joinUrl,
  readErrorDetail,
  type GenerateInput,
  type GenerateResult,
} from './http'

export const ANTHROPIC_VERSION = '2023-06-01'
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 1024

export interface AnthropicTarget {
  baseUrl: string
  apiKey?: string | null
}

function headers(t: AnthropicTarget, json: boolean): Record<string, string> {
  const h: Record<string, string> = { 'anthropic-version': ANTHROPIC_VERSION }
  if (json) h['Content-Type'] = 'application/json'
  if (t.apiKey) h['x-api-key'] = t.apiKey
  return h
}

/** Exported for tests. */
export function buildAnthropicBody(model: string, input: GenerateInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: input.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
    messages: [{ role: 'user', content: input.prompt }],
  }
  if (input.system) body.system = input.system
  return body
}

export async function anthropicChat(
  t: AnthropicTarget,
  model: string,
  input: GenerateInput
): Promise<GenerateResult> {
  if (!t.apiKey) return { ok: false, error: 'Anthropic: no API key' }
  try {
    const res = await fetchWithTimeout(
      joinUrl(t.baseUrl, '/messages'),
      { method: 'POST', headers: headers(t, true), body: JSON.stringify(buildAnthropicBody(model, input)) },
      input.timeoutMs ?? 180_000
    )
    if (!res.ok) return { ok: false, error: await readErrorDetail(res, 'Anthropic') }
    const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> }
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
    return { ok: true, text: text.trim() }
  } catch (err) {
    return { ok: false, error: errMessage(err) }
  }
}

export async function anthropicListModels(
  t: AnthropicTarget,
  timeoutMs = 6000
): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  if (!t.apiKey) return { ok: false, error: 'Anthropic: no API key' }
  try {
    const res = await fetchWithTimeout(
      joinUrl(t.baseUrl, '/models'),
      { method: 'GET', headers: headers(t, false) },
      timeoutMs
    )
    if (!res.ok) return { ok: false, error: await readErrorDetail(res, 'Anthropic') }
    const data = (await res.json()) as { data?: Array<{ id?: string }> }
    return {
      ok: true,
      models: (data.data ?? []).map((m) => m.id).filter((x): x is string => !!x),
    }
  } catch (err) {
    return { ok: false, error: errMessage(err) }
  }
}
