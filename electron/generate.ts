/**
 * Grounded Q&A: retrieve → optional LLM (Ollama/Grok) → validate citations.
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

export function buildGroundedPrompt(
  question: string,
  hits: SearchHit[],
  options?: {
    systemExtra?: string
    history?: Array<Pick<ChatMessage, 'role' | 'content'>>
  }
): string {
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

  return `${guidance}

Passages:
${passages}
${historyBlock}
Question: ${question}

Answer (with [id] citations):`
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

  const prompt = buildGroundedPrompt(input.question, hits, {
    systemExtra: input.systemExtra,
  })
  const gen = await llmGenerate(prompt)
  if (!gen.ok) {
    const msg = gen.error
    const name = providerDisplayName(gen.provider)
    let answer: string
    if (/no api key/i.test(msg)) {
      answer = `${msg}. Showing search hits only — add a key in Advanced or use Ollama.`
    } else if (/no models/i.test(msg)) {
      answer = `${msg}. Pull a model (e.g. llama3.2) and retry.`
    } else if (/offline/i.test(msg)) {
      answer = `${name === 'AI' ? 'AI' : name} is offline. Showing search hits only — search still works.`
    } else if (gen.provider) {
      answer = `${name} call failed (${msg}). Showing search hits only.`
    } else {
      answer = `${msg}. Showing search hits only.`
    }
    return {
      answer,
      citations: [],
      hits,
      offline: true,
      error: msg,
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
