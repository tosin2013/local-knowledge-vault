/**
 * Grounded Q&A: retrieve → provider registry (local-first) → validate citations.
 * Citations MUST be subset of retrieved hit IDs; hallucinated IDs are dropped.
 */
import type {
  AnswerProvider,
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
/** Same as CITE_RE but with optional leading spaces so a stripped marker does not
 *  leave a stray double-space or a space before punctuation. */
const STRIP_INVALID_RE = /[ \t]*\[(itm_[a-zA-Z0-9]+)\]/g

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

/**
 * Remove citation markers whose id was not retrieved (hallucinations). Valid
 * markers stay as grounding anchors; invalid ids are stripped so a user never
 * sees a citation-looking marker that points nowhere (#38).
 */
export function stripInvalidCitations(answer: string, allowedIds: Set<string> | string[]): string {
  const allowed = allowedIds instanceof Set ? allowedIds : new Set(allowedIds)
  return answer.replace(STRIP_INVALID_RE, (full, id) => (allowed.has(id) ? full : ''))
}

/** Label prepended when a model answers but cites none of the retrieved notes. */
export const UNCITED_LABEL = '⚠ No notes cited — this answer may not be grounded in your notes.'

/**
 * Finalize a model answer for display: strip hallucinated citation markers,
 * apply the empty-response sentinel, and flag answers that cite nothing (#38).
 */
export function finalizeAnswer(text: string, allowedIds: Set<string> | string[]): string {
  const cleaned = stripInvalidCitations(text, allowedIds).trim()
  if (!cleaned) return '(empty model response)'
  // After stripping, only valid markers remain — none left means it cites nothing.
  if (extractCitedIds(cleaned).length === 0) return `${UNCITED_LABEL}\n\n${cleaned}`
  return cleaned
}

const HISTORY_CHAR_CAP = 4000

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
    // Cap history by characters (not just turns) so a long chat can't push the
    // prompt past the context window and silently truncate the rules (#36).
    // Keep the most recent turns, dropping the oldest first.
    let block = turns.join('\n\n')
    for (let i = 1; i <= turns.length && block.length > HISTORY_CHAR_CAP; i++) {
      block = turns.slice(i).join('\n\n')
    }
    historyBlock = `\n\nConversation so far:\n${block}\n`
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

/** The provider that wrote an answer, in the shape the renderer shows (#45). */
export function answerProvider(gen: {
  provider: string
  providerLabel: string
  model: string
  local: boolean
  fallback: boolean
}): AnswerProvider {
  return { id: gen.provider, label: gen.providerLabel, model: gen.model, local: gen.local, fallback: gen.fallback }
}

export function citationsFromIds(ids: string[]): Citation[] {
  return ids.map((id) => {
    const item = getItem(id)
    return { id, title: item?.title ?? id, project: item?.project ?? null }
  })
}

export async function askGrounded(input: AskGroundedInput): Promise<AskGroundedResult> {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20)
  const { hits } = searchQuery({
    text: input.question,
    filters: input.filters,
    limit,
    sourcesLast: input.sourcesLast ?? true,
  })

  if (hits.length === 0) {
    return {
      answer:
        'I couldn\'t find that in your notes. Try different words, or broaden Project / Profile if you\'re narrowed to one project.',
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
    answer: finalizeAnswer(gen.text, allowed),
    citations: citationsFromIds(validIds),
    hits,
    provider: answerProvider(gen),
  }
}
