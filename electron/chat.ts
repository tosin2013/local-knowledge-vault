/**
 * Grounded multi-turn chat: persist sessions/messages, retrieve → LLM → cite.
 */
import type { AnswerProvider, ChatMessage, ChatSendInput, ChatSendResult, Citation, SearchHit } from './types'
import {
  appendMessage,
  getPrompt,
  getSession,
  listMessages,
  updateSessionTitle,
} from './db'
import { searchQuery } from './search'
import { llmGenerate } from './llm'
import {
  buildGroundedMessages,
  answerProvider,
  citationsFromIds,
  offlineCopy,
  extractCitedIds,
  validateCitations,
  finalizeAnswer,
} from './generate'

const HISTORY_TURNS = 6 // last N user+assistant messages (pairs ≈ 3 rounds)
/** Max chars for the FTS retrieval query built from multi-turn user text */
const SEARCH_QUERY_MAX_CHARS = 700
/** Latest user text shorter than this pulls prior user turns more heavily into search */
const SHORT_FOLLOWUP_CHARS = 20
/** How many prior user messages to fold into the search query */
const PRIOR_USER_SEARCH_TURNS = 3

function titleFromUserText(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return 'New chat'
  // Prefer first sentence-ish chunk; keep titles readable in the session list.
  const cut = cleaned.split(/[?!.\n]/)[0]?.trim() || cleaned
  const base = cut.length >= 12 ? cut : cleaned
  return base.length > 48 ? base.slice(0, 45).trimEnd() + '…' : base
}

function isUntitledSessionTitle(title: string): boolean {
  const t = (title ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  return !t || t === 'new chat' || t === 'untitled' || t === 'untitled chat'
}

function parseCitations(json: string | null): Citation[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as Citation[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Build an FTS search string from the latest user message plus recent prior
 * user turns. Pure string merge (no LLM rewrite) so short follow-ups like
 * "both" / "why" still retrieve the substantive topic from earlier turns.
 *
 * - Short latest (< ~20 chars): prior user texts first (weighted), then latest.
 * - Longer latest: latest first (dominant), then priors for light continuity.
 * - Cap total length (~700 chars), keeping the front (weighted) side.
 */
export function buildChatSearchQuery(latest: string, priorUserTexts: string[]): string {
  const latestTrim = (latest ?? '').replace(/\s+/g, ' ').trim()
  const priors = (priorUserTexts ?? [])
    .map((t) => (t ?? '').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 0)
    .slice(-PRIOR_USER_SEARCH_TURNS)

  if (!latestTrim && priors.length === 0) return ''
  if (!latestTrim) {
    return clampSearchQuery(priors.join(' '))
  }
  if (priors.length === 0) {
    return clampSearchQuery(latestTrim)
  }

  const short = latestTrim.length < SHORT_FOLLOWUP_CHARS
  const merged = short
    ? [...priors, latestTrim].join(' ')
    : [latestTrim, ...priors].join(' ')

  return clampSearchQuery(merged.replace(/\s+/g, ' ').trim())
}

function clampSearchQuery(q: string): string {
  if (q.length <= SEARCH_QUERY_MAX_CHARS) return q
  return q.slice(0, SEARCH_QUERY_MAX_CHARS).trim()
}

/**
 * Pure social / orienting openers — not real note questions.
 * Keep short so "hello what does Callicles say" still retrieves.
 */
export function isGreetingOrSocial(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!t || t.length > 80) return false
  const patterns: RegExp[] = [
    /^(hi|hello|hey|yo|hiya|howdy)([!.]*)$/,
    /^(hi|hello|hey)\s+there([!.]*)$/,
    /^good\s+(morning|afternoon|evening|night)([!.]*)$/,
    /^(thanks|thank\s+you|thx)([!.]*)$/,
    /^(what\s+can\s+you\s+do|how\s+does\s+this\s+work|help)([?.!]*)$/,
  ]
  return patterns.some((p) => p.test(t))
}

function greetingReply(text: string, opts: { project?: string; promptName?: string }): string {
  const t = text.replace(/\s+/g, ' ').trim().toLowerCase()
  const project = (opts.project ?? '').trim()
  const promptName = (opts.promptName ?? '').trim()
  const scope = project
    ? `You're in ${project} notes.`
    : `You're chatting with your vault notes.`
  const voice = promptName ? ` Personality: ${promptName}.` : ''

  if (/^(thanks|thank\s+you|thx)/.test(t)) {
    return `You're welcome. Ask whenever you're ready — I'll answer from your notes when I can.`
  }
  if (/what\s+can\s+you\s+do|how\s+does\s+this\s+work|^help/.test(t)) {
    return (
      `I answer from your notes and cite them when I can.${voice}\n\n` +
      `${scope} Try a topic, a name, or something you wrote — for example a person, idea, or section you care about.`
    )
  }
  // hi / hello / hey / good morning…
  if (project) {
    return (
      `Hi — ${scope}${voice}\n\n` +
      `Ask about something in those notes, or try a concrete question (a name, argument, or section). ` +
      `I look things up in your vault rather than guessing.`
    )
  }
  return (
    `Hi — ${scope}${voice}\n\n` +
    `Ask about something you've saved, or switch Profile if you want to focus on one project. ` +
    `I'll use your notes when I answer.`
  )
}

/** Exported for tests that want to inspect citation parsing */
export { parseCitations }

export async function sendChatTurn(input: ChatSendInput): Promise<ChatSendResult> {
  const session = getSession(input.sessionId)
  if (!session) {
    throw new Error(`Session not found: ${input.sessionId}`)
  }

  const text = input.text.trim()
  if (!text) {
    throw new Error('Message text is empty')
  }

  // Prior user turns for retrieval (before appending the current message)
  const priorUserTexts = listMessages(session.id)
    .filter((m) => m.role === 'user')
    .map((m) => m.content)

  // Append user message first so offline path still persists it
  appendMessage({
    session_id: session.id,
    role: 'user',
    content: text,
  })

  // Auto-title from first user message on untitled sessions
  let currentSession = session
  const isFirstUserTurn = priorUserTexts.length === 0
  if (isFirstUserTurn && isUntitledSessionTitle(session.title)) {
    const titled = updateSessionTitle(session.id, titleFromUserText(text))
    if (titled) currentSession = titled
  }

  // Resolve optional prompt body
  let systemExtra = input.systemPrompt?.trim() || undefined
  if (!systemExtra && input.promptId) {
    const prompt = getPrompt(input.promptId)
    if (prompt?.body?.trim()) {
      systemExtra = prompt.body.trim()
    }
  }

  const finish = (
    content: string,
    citations: Citation[],
    hitList: SearchHit[],
    extra?: { offline?: boolean; error?: string; provider?: AnswerProvider }
  ): ChatSendResult => {
    const assistant = appendMessage({
      session_id: session.id,
      role: 'assistant',
      content,
      citations_json: citations.length ? JSON.stringify(citations) : null,
      hits_json: hitList.length ? JSON.stringify(hitList) : null,
      provider_json: extra?.provider ? JSON.stringify(extra.provider) : null,
    })
    const messages = listMessages(session.id)
    const updated = getSession(session.id) ?? currentSession
    return {
      assistant,
      messages,
      session: updated,
      offline: extra?.offline,
      error: extra?.error,
    }
  }

  // Greetings / social openers: orient the user — never "no matching notes"
  if (isGreetingOrSocial(text)) {
    let promptName: string | undefined
    if (input.promptId) {
      const p = getPrompt(input.promptId)
      promptName = p?.name
    }
    return finish(
      greetingReply(text, {
        project: input.filters?.project,
        promptName,
      }),
      [],
      []
    )
  }

  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20)
  const searchText = buildChatSearchQuery(text, priorUserTexts)
  const { hits } = searchQuery({
    text: searchText,
    filters: input.filters,
    limit,
    sourcesLast: input.sourcesLast ?? true,
  })

  if (hits.length === 0) {
    const project = (input.filters?.project ?? '').trim()
    const soft = project
      ? `I couldn't find that in your ${project} notes. Try a name or topic from those notes, or switch Profile to search more broadly.`
      : `I couldn't find that in your notes. Try different words, or clear Project / Profile scope if you're narrowed to one project.`
    return finish(soft, [], [])
  }

  // Prior messages excluding the user msg we just appended (and any system)
  const prior = listMessages(session.id).filter((m) => m.id !== undefined)
  // Drop the last message (current user turn) from history for the prompt
  const beforeCurrent = prior.slice(0, -1)
  const recent = beforeCurrent
    .filter((m: ChatMessage) => m.role === 'user' || m.role === 'assistant')
    .slice(-HISTORY_TURNS)

  const grounded = buildGroundedMessages(text, hits, {
    systemExtra,
    history: recent.map((m) => ({ role: m.role, content: m.content })),
  })

  const gen = await llmGenerate(grounded)
  if (!gen.ok) {
    const content = offlineCopy(gen, 'Your message was saved — showing search context only')
    return finish(content, [], hits, { offline: true, error: gen.error })
  }

  const allowed = new Set(hits.map((h) => h.id))
  const rawCited = extractCitedIds(gen.text)
  const validIds = validateCitations(rawCited, allowed)
  const citations = citationsFromIds(validIds)

  return finish(finalizeAnswer(gen.text, allowed), citations, hits, { provider: answerProvider(gen) })
}
