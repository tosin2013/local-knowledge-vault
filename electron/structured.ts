/**
 * Structured-output guard for reasoning models (#275).
 *
 * Study card questions, sample questions and test parsing expect the model to
 * return a shaped reply (JSON / a numbered list). Reasoning families break that
 * in three ways: the thinking burns the output budget and the reply comes back
 * empty or cut off mid-JSON (gpt-oss), `think: false` is ignored and the
 * deliberation is streamed as plain prose (qwen3:4b), or reasoning effort
 * crowds out the answer. `structuredGenerate` wraps `llmGenerate` for these
 * calls: it asks for low reasoning effort where the provider supports it,
 * classifies each reply (usable / ran-out-of-tokens / reasoning-instead-of-
 * output), retries a ran-out reply once with a larger budget, falls back to the
 * qwen3 `/no_think` soft switch when the model reasoned out loud, and never
 * returns reasoning text as if it were the answer.
 */
import { llmGenerate, type LlmGenerateResult } from './llm'
import {
  hasBalancedJson,
  isReasoningModel,
  looksLikeUntaggedReasoning,
  noThinkDirective,
} from './providers/http'

/** What shape the caller expects, used only to classify a reply. */
export type StructuredExpect = 'json' | 'list'

export type ReplyClass = 'usable' | 'ran-out' | 'reasoning'

/**
 * Classify one reply. Pure.
 * - empty text, or a provider "length" cutoff, or (for JSON) brackets left
 *   open → the model ran out of output tokens;
 * - prose that opens like deliberation with none of the expected shape → the
 *   model reasoned out loud (qwen3 ignoring `think: false`);
 * - anything else is left to the caller's own parser/fallbacks.
 */
export function classifyStructuredReply(
  text: string,
  opts: { truncated?: boolean; expect: StructuredExpect }
): ReplyClass {
  const t = text ?? ''
  if (!t.trim()) return 'ran-out'
  if (opts.truncated) return 'ran-out'
  if (opts.expect === 'json') {
    if (/[{[]/.test(t)) return hasBalancedJson(t) ? 'usable' : 'ran-out'
  } else if (/^\s*(?:\d+\s*[.)]|[-*•])\s+\S/m.test(t)) {
    return 'usable'
  }
  return looksLikeUntaggedReasoning(t) ? 'reasoning' : 'usable'
}

export interface StructuredGenerateInput {
  system?: string
  prompt: string
  maxTokens?: number
  /** Budget for the single ran-out retry. Default: twice `maxTokens`. */
  retryMaxTokens?: number
  expect?: StructuredExpect
  timeoutMs?: number
}

export type StructuredGenerateResult =
  | (Extract<LlmGenerateResult, { ok: true }> & { reasoningFallbackUsed?: boolean })
  | (Extract<LlmGenerateResult, { ok: false }> & { ranOutOfTokens?: boolean })

/** Human message for a reply that was deliberation, not the asked-for output. */
function reasoningError(label: string | undefined, helped: boolean): string {
  const name = label || 'The model'
  return (
    `${name} spent the call reasoning out loud instead of returning the structured output ` +
    `(its no-think setting was ignored${helped ? ', and the /no_think fallback did not help' : ''}). ` +
    `Try qwen3:1.7b, which follows it, or a non-reasoning model.`
  )
}

/** Human message for a reply that never made it to the end of its output budget. */
function ranOutError(label: string | undefined, retried: boolean): string {
  const name = label || 'The model'
  return (
    `${name} ran out of output tokens before finishing the reply — reasoning models spend ` +
    `part of the budget thinking${retried ? ', and a retry with a larger budget was cut off too' : ''}. ` +
    `Try a smaller model such as qwen3:1.7b on CPU.`
  )
}

/**
 * One structured generation with the #275 guard. At most two model calls:
 * the first reply decides the recovery path — a ran-out reply is retried once
 * with the larger budget, a reasoning-out-loud reply from a reasoning-family
 * model is retried once with the `/no_think` directive appended — and a still
 * unusable outcome comes back as `ok: false` with a clear, actionable error.
 */
export async function structuredGenerate(
  input: StructuredGenerateInput
): Promise<StructuredGenerateResult> {
  const expect: StructuredExpect = input.expect ?? 'json'
  const retryMaxTokens = input.retryMaxTokens ?? (input.maxTokens ? input.maxTokens * 2 : undefined)
  const base = {
    system: input.system,
    prompt: input.prompt,
    maxTokens: input.maxTokens,
    timeoutMs: input.timeoutMs,
    // Structured calls want the answer, not the thinking (#275).
    reasoningEffort: 'low' as const,
  }

  const first = await llmGenerate(base)
  if (!first.ok) return first
  const firstClass = classifyStructuredReply(first.text, { truncated: first.truncated, expect })
  if (firstClass === 'usable') return first

  if (firstClass === 'reasoning') {
    // qwen3:4b ignores `think: false`; the /no_think soft switch still lands (#275).
    if (!isReasoningModel(first.model)) {
      return { ok: false, error: reasoningError(first.providerLabel, false), provider: first.provider, providerLabel: first.providerLabel }
    }
    const retry = await llmGenerate({ ...base, prompt: noThinkDirective(input.prompt) })
    if (retry.ok) {
      const retryClass = classifyStructuredReply(retry.text, { truncated: retry.truncated, expect })
      if (retryClass === 'usable') return { ...retry, reasoningFallbackUsed: true }
      if (retryClass === 'reasoning') {
        return { ok: false, error: reasoningError(retry.providerLabel || first.providerLabel, true), provider: retry.provider, providerLabel: retry.providerLabel || first.providerLabel }
      }
      return { ok: false, error: ranOutError(retry.providerLabel || first.providerLabel, true), ranOutOfTokens: true, provider: retry.provider, providerLabel: retry.providerLabel || first.providerLabel }
    }
    return { ok: false, error: retry.error || reasoningError(first.providerLabel, true), provider: retry.provider, providerLabel: retry.providerLabel || first.providerLabel }
  }

  // Ran out of output tokens: one retry with the larger budget, then a clear error.
  if (!retryMaxTokens) {
    return { ok: false, error: ranOutError(first.providerLabel, false), ranOutOfTokens: true, provider: first.provider, providerLabel: first.providerLabel }
  }
  const retry = await llmGenerate({ ...base, maxTokens: retryMaxTokens })
  if (retry.ok) {
    const retryClass = classifyStructuredReply(retry.text, { truncated: retry.truncated, expect })
    if (retryClass === 'usable') return retry
    if (retryClass === 'reasoning') {
      return { ok: false, error: reasoningError(retry.providerLabel || first.providerLabel, false), provider: retry.provider, providerLabel: retry.providerLabel || first.providerLabel }
    }
    return { ok: false, error: ranOutError(retry.providerLabel || first.providerLabel, true), ranOutOfTokens: true, provider: retry.provider, providerLabel: retry.providerLabel || first.providerLabel }
  }
  return { ok: false, error: retry.error || ranOutError(first.providerLabel, true), ranOutOfTokens: true, provider: retry.provider, providerLabel: retry.providerLabel || first.providerLabel }
}
