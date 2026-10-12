/** Shared HTTP helpers for provider adapters. Never log request headers (keys). */

export interface GenerateInput {
  /** Grounding rules / system prompt (identical across providers). */
  system?: string
  /** User turn: passages + history + question. */
  prompt: string
  maxTokens?: number
  timeoutMs?: number
  /**
   * Ask the provider to spend less on reasoning before answering (#275).
   * Sent as `reasoning_effort` on OpenAI-compatible providers, and only for
   * reasoning-family models (others may reject the parameter).
   */
  reasoningEffort?: 'low' | 'medium' | 'high'
}

export type GenerateResult =
  | { ok: true; text: string; /** The reply was cut off by the output-token limit (#275). */ truncated?: boolean }
  | { ok: false; error: string }

export async function fetchWithTimeout(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s (${new URL(url).host})`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export function joinUrl(base: string, pathPart: string): string {
  return `${base.replace(/\/+$/, '')}/${pathPart.replace(/^\/+/, '')}`
}

/** Pull a readable message out of an error body (OpenAI / Anthropic / generic shapes). */
export async function readErrorDetail(res: Response, prefix: string): Promise<string> {
  let detail = `${prefix} HTTP ${res.status}`
  try {
    const text = await res.text()
    try {
      const body = JSON.parse(text) as {
        error?: { message?: string } | string
        message?: string
        detail?: string
      }
      if (typeof body.error === 'string') detail = `${detail}: ${body.error}`
      else if (body.error?.message) detail = `${detail}: ${body.error.message}`
      else if (body.message) detail = `${detail}: ${body.message}`
      else if (body.detail) detail = `${detail}: ${body.detail}`
    } catch {
      if (text.trim()) detail = `${detail}: ${text.trim().slice(0, 200)}`
    }
  } catch {
    /* ignore */
  }
  return redactError(detail)
}

/** Strip account identifiers (org_…, req_…, request ids) from user-visible errors (#274). */
export function redactError(text: string): string {
  return (text ?? '')
    .replace(/\borg_[a-z0-9_-]+/gi, 'org_<redacted>')
    .replace(/\breq_[a-z0-9_-]+/gi, 'req_<redacted>')
    .replace(/\brequest[-_ ]?id(?:[=:]\s*)?[a-z0-9_-]+/gi, 'request id <redacted>')
}

/** A provider error that is a rate limit (HTTP 429 or "rate limit" in the message). */
export function isRateLimited(error: string): boolean {
  return /429|rate ?limit/i.test(error ?? '')
}

/** Parse a "try again in X" wait from a rate-limit message, in milliseconds. */
export function retryAfterMs(error: string): number | undefined {
  const s = error ?? ''
  // "2m3.1s" (minutes + seconds)
  let m = s.match(/(\d+(?:\.\d+)?)\s*m\s*(\d+(?:\.\d+)?)\s*s/i)
  if (m) return Math.round(parseFloat(m[1]) * 60_000 + parseFloat(m[2]) * 1000)
  // "7.5s" / "12 s" / "450ms" / "2 minutes"
  m = s.match(/(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds?|m|min|minutes?|h|hours?)/i)
  if (m) {
    const n = parseFloat(m[1])
    const u = m[2].toLowerCase()
    if (u === 'ms') return Math.round(n)
    if (u.startsWith('h')) return Math.round(n * 3_600_000)
    if (u.startsWith('m')) return Math.round(n * 60_000)
    return Math.round(n * 1000)
  }
  return undefined
}

/** Humanise a millisecond wait for a user message ("12 s", "2 m", "7 s"). */
export function formatWait(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} m`
  return `${Math.round(ms / 3_600_000)} h`
}

/** Reasoning models (qwen3, deepseek-r1 …) may inline <think>…</think>; never show it as the answer. */
export function stripThinking(text: string): string {
  // Closed blocks anywhere, then any unclosed block to end-of-string (not just
  // a leading one), so a mid-answer unclosed <think> can't leak reasoning (#36).
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trim()
}

/**
 * Reasoning-family model names (qwen3, gpt-oss, deepseek-r1, QwQ, *-reasoning).
 * These spend part of any output budget thinking, so structured calls to them
 * need a bigger budget and, where supported, a low reasoning effort (#275).
 */
export function isReasoningModel(model: string): boolean {
  return /qwen3|qwq|gpt-oss|deepseek-r1|reasoning/i.test(model ?? '')
}

const REASONING_OPENERS =
  /^(?:wait\b|okay\b|ok,|hmm\b|alright\b|let'?s think|let me think|let me work|let me see|i need to|first,[ \t]|step 1\b|thinking:)/i

/**
 * Detect qwen3-style *untagged* reasoning: the model ignored `think: false` and
 * streams its deliberation as plain prose ("Wait, the answer must be short…"),
 * with no <think> tags for stripThinking to catch (#275). Single-purpose check —
 * electron/structured.ts combines it with the expected reply shape.
 */
export function looksLikeUntaggedReasoning(text: string): boolean {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return false
  return REASONING_OPENERS.test(trimmed)
}

/**
 * Whether a reply's JSON is complete: at least one `{`/`[` and every opening
 * bracket closed by the end. Code fences are tolerated; braces inside strings
 * are ignored. Unbalanced brackets = the reply was cut off mid-JSON (#275).
 */
export function hasBalancedJson(text: string): boolean {
  const s = (text ?? '').replace(/```[a-z]*\n?/gi, '')
  let inString = false
  let escaped = false
  const stack: string[] = []
  for (const ch of s) {
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') {
      const open = stack.pop()
      if ((ch === '}' && open !== '{') || (ch === ']' && open !== '[')) return false
    }
  }
  return stack.length === 0 && !inString && /\{|\[/.test(s)
}

/** Append the qwen3 `/no_think` soft switch, which `think: false` cannot replace (#275). */
export function noThinkDirective(prompt: string): string {
  return `${(prompt ?? '').trimEnd()}\n\n/no_think`
}

export function errMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause
    if (cause?.code === 'ECONNREFUSED') return `Connection refused (${cause.message ?? 'is the server running?'})`
    if (cause?.code) return `${err.message} (${cause.code})`
    return err.message
  }
  return String(err)
}
