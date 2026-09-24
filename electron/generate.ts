/**
 * Grounded Q&A: retrieve → provider registry (local-first) → validate citations.
 * Citations MUST be subset of retrieved hit IDs; hallucinated IDs are dropped.
 */
import type {
  AskGroundedInput,
  AskGroundedResult,
  ChatMessage,
  Citation,
  SearchHit,
} from './types'
import { getItem } from './db'
import { searchQuery } from './search'
import { llmGenerate, providerDisplayName } from './llm'

const CITE_RE = /\[(itm_[a-zA-Z0-9]+)\]/g

/** Extract cited item ids from model answer text */
export function extractCitedIds(answer: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  const re = new RegExp(CITE_RE.source, 'g')
  while ((m = re.exec(answer)) !== null) {
    const id = m[1]
    if (!seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

/**
 * Keep only ids present in the retrieved set. Drop hallucinations.
 * Pure function — safe to unit test without DB/Ollama.
 */
export function validateCitations(
  citedIds: string[],
  allowedIds: Set<string> | string[]
): string[] {
  const allowed = allowedIds instanceof Set ? allowedIds : new Set(allowedIds)
  return citedIds.filter((id) => allowed.has(id))
}

const GROUNDED_RULES = `You are a careful assistant for a personal notes vault.
Answer the user's question ONLY using the numbered passages below.
Use plain, everyday language. Do not lead with how the vault or search engine works (SQLite, FTS, PARA, etc.) unless the user asks.
Cite supporting passages using square brackets with the exact item id, e.g. [itm_abc123].
If the passages do not contain enough information, say so honestly.
Do not invent facts or cite ids that are not listed.`

export interface GroundedMessages {
  /** Grounding rules (+ personality guidance). Same text for every provider. */
  system: string
  /** Passages + conversation so far + question. */
  prompt: string
}

/**
 * Split the grounded prompt into a system part (rules) and a user part (passages + question).
 * Every provider gets exactly these two strings — only the transport differs
 * (Ollama `system`, OpenAI-style system message, Anthropic top-level `system`).
 */
export function buildGroundedMessages(
  question: string,
  hits: SearchHit[],
  options?: {
    systemExtra?: string
    history?: Array<Pick<ChatMessage, 'role' | 'content'>>
  }
): GroundedMessages {
  const passages = hits
    .map((h, i) => {
      const item = getItem(h.id)
      const body = item?.body?.slice(0, 1200) ?? h.snippet
      return `[Passage ${i + 1}] id=${h.id}\ntitle: ${h.title}\n${body}`
    })
    .join('\n\n')

  const extra = options?.systemExtra?.trim()
  const guidance = extra
    ? `${GROUNDED_RULES}\n\nAdditional guidance:\n${extra}`
    : GROUNDED_RULES

  let historyBlock = ''
  const history = options?.history ?? []
  if (history.length > 0) {
    const turns = history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n')
    historyBlock = `\n\nConversation so far:\n${turns}\n`
  }

  return {
    system: guidance,
    prompt: `Passages:
${passages}
${historyBlock}
Question: ${question}

Answer (with [id] citations):`,
  }
}

/** Single-string form (rules + passages + question). Kept for tests / legacy callers. */
export function buildGroundedPrompt(
  question: string,
  hits: SearchHit[],
  options?: {
    systemExtra?: string
    history?: Array<Pick<ChatMessage, 'role' | 'content'>>
  }
): string {
  const m = buildGroundedMessages(question, hits, options)
  return `${m.system}\n\n${m.prompt}`
}

/** Friendly copy when no provider could answer. Shared by Ask + Chat. */
export function offlineCopy(
  gen: { error: string; provider?: string | null; providerLabel?: string },
  suffix: string
): string {
  const msg = gen.error
  const name = providerDisplayName(gen.provider, gen.providerLabel)
  if (/api key/i.test(msg)) return `${msg}. ${suffix} — add the key in Advanced → AI providers, or use a local model.`
  if (/no models|ollama pull/i.test(msg)) return `${msg}. ${suffix}.`
  if (/no local model detected|not running/i.test(msg)) {
    return `Vault runs on local models — start Ollama or LM Studio (or add a cloud provider in Advanced). ${suffix}.`
  }
  if (gen.provider) return `${name} call failed (${msg}). ${suffix}.`
  return `${msg}. ${suffix}.`
}

export function citationsFromIds(ids: string[]): Citation[] {
  return ids.map((id) => {
    const item = getItem(id)
    return { id, title: item?.title ?? id }
  })
}

export async function askGrounded(input: AskGroundedInput): Promise<AskGroundedResult> {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20)
  const { hits } = searchQuery({
    text: input.question,
    filters: input.filters,
    limit,
  })

  if (hits.length === 0) {
    return {
      answer:
        'I couldn\'t find that in your notes. Try different words, or broaden Notes from / Profile if you\'re narrowed to one project.',
      citations: [],
      hits: [],
    }
  }

  const messages = buildGroundedMessages(input.question, hits, {
    systemExtra: input.systemExtra,
  })
  const gen = await llmGenerate(messages)
  if (!gen.ok) {
    return {
      answer: offlineCopy(gen, 'Showing search hits only'),
      citations: [],
      hits,
      offline: true,
      error: gen.error,
    }
  }

  const allowed = new Set(hits.map((h) => h.id))
  const rawCited = extractCitedIds(gen.text)
  const validIds = validateCitations(rawCited, allowed)

  return {
    answer: gen.text.trim() || '(empty model response)',
    citations: citationsFromIds(validIds),
    hits,
  }
}
