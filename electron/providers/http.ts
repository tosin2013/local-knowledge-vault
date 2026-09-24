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
  return detail
}

/** Reasoning models (qwen3, deepseek-r1 …) may inline <think>…</think>; never show it as the answer. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^\s*<think>[\s\S]*$/i, '').trim()
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
