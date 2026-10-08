/** Shared HTTP helpers for provider adapters. Never log request headers (keys). */

export interface GenerateInput {
  /** Grounding rules / system prompt (identical across providers). */
  system?: string
  /** User turn: passages + history + question. */
  prompt: string
  maxTokens?: number
  timeoutMs?: number
}

export type GenerateResult = { ok: true; text: string } | { ok: false; error: string }

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

export function errMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause
    if (cause?.code === 'ECONNREFUSED') return `Connection refused (${cause.message ?? 'is the server running?'})`
    if (cause?.code) return `${err.message} (${cause.code})`
    return err.message
  }
  return String(err)
}
