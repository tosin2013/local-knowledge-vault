/**
 * Ingest Plato's Gorgias (Project Gutenberg HTML) as many searchable vault notes,
 * add a "Gorgias reader" chat persona, and smoke-test search + grounded Ask/Chat.
 *
 * Run (from repo root):
 *   ELECTRON_RUN_AS_NODE=1 electron -r tsx/cjs scripts/ingest-gorgias.ts
 */
import {
  initDb,
  createItem,
  deleteItem,
  listItems,
  listPrompts,
  createPrompt,
  updatePrompt,
  createSession,
  closeDb,
} from '../electron/db'
import { setLlmUserDataDir, getLlmSettingsPublic } from '../electron/llm-settings'
import { searchQuery } from '../electron/search'
import { askGrounded } from '../electron/generate'
import { sendChatTurn } from '../electron/chat'

const SOURCE_URL = 'https://www.gutenberg.org/files/1672/1672-h/1672-h.htm'
const DB_PATH = '/home/box/.config/local-knowledge-vault/lkv.sqlite'
const USER_DATA = '/home/box/.config/local-knowledge-vault'
const PROJECT = 'Gorgias'
const PROMPT_NAME = 'Gorgias reader'
const TRANSLATOR = 'Benjamin Jowett'

/** Keep passages short enough that Grounded Ask's 1200-char prefix carries the argument. */
const TARGET_CHARS = 2000
const MAX_CHARS = 2500
const MIN_CHARS = 1500

const SPEAKER_RE =
  /^(SOCRATES|GORGIAS|POLUS|CALLICLES|CHAEREPHON)\s*:/i

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&rdquo;/gi, '"')
    .replace(/&ldquo;/gi, '"')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

function htmlToText(html: string): string {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
  t = t.replace(/<br\s*\/?>/gi, '\n')
  t = t.replace(/<\/(p|div|h[1-6]|tr|li|blockquote)>/gi, '\n\n')
  t = t.replace(/<(p|div|h[1-6]|li|blockquote)(\s[^>]*)?>/gi, '\n')
  t = t.replace(/<hr\s*\/?>/gi, '\n\n')
  t = t.replace(/<[^>]+>/g, '')
  t = decodeEntities(t)
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n')
  t = t.replace(/[ \t]{2,}/g, ' ')
  t = t.replace(/\n{3,}/g, '\n\n')
  return t.trim()
}

function extractEbookBody(html: string): string {
  const start = html.search(/\*\*\*\s*START OF (THE PROJECT GUTENBERG EBOOK|THIS PROJECT GUTENBERG EBOOK)[^*]*\*\*\*/i)
  const end = html.search(/\*\*\*\s*END OF (THE PROJECT GUTENBERG EBOOK|THIS PROJECT GUTENBERG EBOOK)[^*]*\*\*\*/i)
  let slice = html
  if (start >= 0) {
    const after = html.indexOf('>', start)
    const from = after >= 0 ? after + 1 : start
    slice = end > from ? html.slice(from, end) : html.slice(from)
  }
  // Drop trailing Gutenberg license block if it leaked before END marker
  const license = slice.search(/End of (the )?Project Gutenberg/i)
  if (license > 0) slice = slice.slice(0, license)
  return slice
}

interface Chunk {
  section: 'Introduction' | 'Dialogue'
  text: string
  index: number
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter((p) => p.length > 0)
}

function splitLongParagraph(para: string): string[] {
  if (para.length <= MAX_CHARS) return [para]

  // Keep speaker turns together where possible, but split unusually long turns
  // at sentence boundaries so no single note overwhelms the grounded prefix.
  const sentences = para.split(/(?<=[.!?])\s+/)
  const pieces: string[] = []
  let buf = ''
  const flush = () => {
    const trimmed = buf.trim()
    if (trimmed) pieces.push(trimmed)
    buf = ''
  }
  for (const sentence of sentences) {
    const candidate = buf ? `${buf} ${sentence}` : sentence
    if (buf && candidate.length > MAX_CHARS) {
      flush()
      buf = sentence
    } else {
      buf = candidate
    }
  }
  flush()

  // A malformed/non-sentence paragraph still gets bounded hard splits.
  if (pieces.length === 1 && pieces[0].length > MAX_CHARS) {
    const hard: string[] = []
    for (let i = 0; i < pieces[0].length; i += MAX_CHARS) {
      hard.push(pieces[0].slice(i, i + MAX_CHARS).trim())
    }
    return hard
  }
  return pieces
}

function chunkSection(
  section: Chunk['section'],
  text: string,
  startIndex: number
): Chunk[] {
  const paras = splitParagraphs(text).flatMap(splitLongParagraph)
  const chunks: Chunk[] = []
  let buf = ''
  let local = 0

  const flush = () => {
    const trimmed = buf.trim()
    if (!trimmed) return
    chunks.push({ section, text: trimmed, index: startIndex + local })
    local += 1
    buf = ''
  }

  for (const para of paras) {
    const candidate = buf ? `${buf}\n\n${para}` : para
    if (buf && candidate.length > MAX_CHARS) {
      flush()
      buf = para
      continue
    }
    if (buf && candidate.length >= TARGET_CHARS) {
      // Prefer a break before a new speaker turn once the passage is substantial.
      if (SPEAKER_RE.test(para) && buf.length >= MIN_CHARS) {
        flush()
        buf = para
        continue
      }
      buf = candidate
      flush()
      continue
    }
    buf = candidate
  }
  flush()
  return chunks
}

function buildChunks(fullText: string): Chunk[] {
  const dialogueMarker = fullText.search(/PERSONS OF THE DIALOGUE/i)
  let intro = fullText
  let dialogue = ''
  if (dialogueMarker >= 0) {
    intro = fullText.slice(0, dialogueMarker).trim()
    dialogue = fullText.slice(dialogueMarker).trim()
  }
  // Drop redundant title/contents noise at top of intro
  intro = intro
    .replace(/^GORGIAS[\s\S]*?INTRODUCTION\s*/i, 'INTRODUCTION\n\n')
    .trim()

  const introChunks = chunkSection('Introduction', intro, 1)
  const dialogueChunks = chunkSection(
    'Dialogue',
    dialogue || fullText,
    introChunks.length + 1
  )
  return [...introChunks, ...dialogueChunks]
}

function titleFor(chunk: Chunk, totalInSection: number, sectionOrdinal: number): string {
  const firstLine = chunk.text.split('\n')[0].slice(0, 80)
  const speaker = firstLine.match(SPEAKER_RE)?.[1]
  const base =
    chunk.section === 'Introduction'
      ? `Gorgias — Introduction part ${sectionOrdinal}`
      : speaker
        ? `Gorgias — Dialogue part ${sectionOrdinal} (${speaker})`
        : `Gorgias — Dialogue part ${sectionOrdinal}`
  if (totalInSection <= 1) {
    return chunk.section === 'Introduction'
      ? 'Gorgias — Introduction'
      : 'Gorgias — Dialogue'
  }
  return base
}

function provenanceHeader(fetchedIso: string): string {
  return [
    `Source: ${SOURCE_URL}`,
    `Fetched: ${fetchedIso}`,
    `Translator: ${TRANSLATOR}`,
    '',
  ].join('\n')
}

async function fetchHtml(): Promise<string> {
  const res = await fetch(SOURCE_URL, {
    headers: {
      'User-Agent': 'LocalKnowledgeVault-ingest/1.0 (+educational; respect robots)',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > 2_000_000) throw new Error(`HTML too large: ${buf.length} bytes`)
  return buf.toString('utf8')
}

function replaceGorgiasItems(): number {
  const existing = listItems({ project: PROJECT })
  let n = 0
  for (const item of existing) {
    if (item.project === PROJECT) {
      deleteItem(item.id)
      n += 1
    }
  }
  return n
}

function upsertGorgiasPrompt(): { id: string; name: string; created: boolean } {
  const body = `You are a book-bound reader for Plato's Gorgias (Jowett translation) using ONLY the vault excerpts provided in this turn.

Rules:
1. Stay inside Plato's Gorgias as reflected in these vault notes. Do not bring in modern philosophy, other dialogues, or general knowledge that is not supported by the provided passages.
2. Prefer clear modern English. Use a character's voice (Socrates, Gorgias, Polus, Callicles, Chaerephon) only when the user asks you to speak as that character — and then still only claim what the passages support.
3. Prefer citing supporting notes with square-bracket item IDs exactly as given, e.g. [itm_abc123]. Only cite IDs that appear in the provided passages.
4. If the passages do not support the ask, say plainly that you do not know from this book / these notes. Do NOT invent from general knowledge.
5. On vague follow-ups ("why", "both", "explain", "go on"), interpret them using the conversation history plus whatever passages were retrieved for this turn. Answer that combined question from the passages; still do not invent outside them.`

  const description =
    'Book-bound Gorgias: cite notes or say you don\'t know.'

  const existing = listPrompts().find((p) => p.name === PROMPT_NAME)
  if (existing) {
    const updated = updatePrompt(existing.id, { body, description })
    return { id: updated!.id, name: updated!.name, created: false }
  }
  const created = createPrompt({ name: PROMPT_NAME, body, description })
  return { id: created.id, name: created.name, created: true }
}

async function main() {
  setLlmUserDataDir(USER_DATA)
  initDb(DB_PATH)

  const llmPublic = getLlmSettingsPublic()
  console.log(
    'LLM settings:',
    JSON.stringify({
      provider: llmPublic.provider,
      groqEnabled: llmPublic.groqEnabled,
      hasGroqKey: llmPublic.hasGroqKey,
      grokEnabled: llmPublic.grokEnabled,
      hasKey: llmPublic.hasKey,
    })
  )

  console.log('Fetching', SOURCE_URL)
  const html = await fetchHtml()
  console.log('HTML bytes', Buffer.byteLength(html, 'utf8'))

  const ebookHtml = extractEbookBody(html)
  const fullText = htmlToText(ebookHtml)
  console.log('Extracted text chars', fullText.length)

  const chunks = buildChunks(fullText)
  console.log('Chunks', chunks.length)
  if (chunks.length < 80 || chunks.length > 180) {
    console.warn(
      `Warning: chunk count ${chunks.length} outside preferred 80–180 (still proceeding)`
    )
  }

  const removed = replaceGorgiasItems()
  console.log('Removed prior Gorgias items', removed)

  const fetchedIso = new Date().toISOString()
  const header = provenanceHeader(fetchedIso)

  const introTotal = chunks.filter((c) => c.section === 'Introduction').length
  const dialogueTotal = chunks.filter((c) => c.section === 'Dialogue').length
  let introOrd = 0
  let dialogueOrd = 0

  const created: Array<{ id: string; title: string; chars: number }> = []
  for (const chunk of chunks) {
    if (chunk.section === 'Introduction') introOrd += 1
    else dialogueOrd += 1
    const sectionOrdinal =
      chunk.section === 'Introduction' ? introOrd : dialogueOrd
    const sectionTotal =
      chunk.section === 'Introduction' ? introTotal : dialogueTotal
    const title = titleFor(chunk, sectionTotal, sectionOrdinal)
    const summary = chunk.text.slice(0, 200).replace(/\s+/g, ' ').trim()
    const item = createItem({
      title,
      summary,
      body: header + chunk.text,
      para: 'resources',
      kind: 'book',
      project: PROJECT,
      status: 'active',
    })
    created.push({ id: item.id, title: item.title, chars: chunk.text.length })
  }

  console.log('Created notes', created.length)
  for (const c of created.slice(0, 8)) {
    console.log(`  - ${c.id}  ${c.title}  (${c.chars} chars)`)
  }
  if (created.length > 8) {
    console.log(`  … and ${created.length - 8} more`)
    for (const c of created.slice(-3)) {
      console.log(`  - ${c.id}  ${c.title}  (${c.chars} chars)`)
    }
  }

  const prompt = upsertGorgiasPrompt()
  console.log(
    'Prompt',
    prompt.created ? 'created' : 'updated',
    prompt.id,
    prompt.name
  )

  // --- Smoke tests ---
  console.log('\n=== SMOKE: search Callicles ===')
  const search = searchQuery({
    text: 'Callicles',
    filters: { project: PROJECT },
    limit: 8,
  })
  console.log(
    'hits',
    search.hits.length,
    search.hits.map((h) => `${h.id}:${h.title}`).join(' | ')
  )

  console.log('\n=== SMOKE: search Callicles concepts ===')
  const conceptSearches = ['superior', 'natural justice', 'stronger']
  for (const term of conceptSearches) {
    const concept = searchQuery({
      text: term,
      filters: { project: PROJECT },
      limit: 5,
    })
    console.log(
      term,
      concept.hits.length,
      concept.hits.map((h) => `${h.id}:${h.title}`).join(' | ')
    )
  }

  console.log('\n=== SMOKE: search rhetoric ===')
  const search2 = searchQuery({
    text: 'rhetoric',
    filters: { project: PROJECT },
    limit: 8,
  })
  console.log(
    'hits',
    search2.hits.length,
    search2.hits.slice(0, 5).map((h) => `${h.id}:${h.title}`).join(' | ')
  )

  const calliclesPrefix = search.hits
    .map((h) => ({ hit: h, item: listItems().find((item) => item.id === h.id) }))
    .find(({ item }) => item?.body.toLowerCase().includes('callicles'))
  console.log(
    'Callicles first-1200 useful:',
    !!calliclesPrefix,
    calliclesPrefix ? `${calliclesPrefix.hit.id} ${calliclesPrefix.hit.title}` : ''
  )
  if (calliclesPrefix) {
    console.log('Callicles prefix:', calliclesPrefix.item!.body.slice(0, 1200).replace(/\s+/g, ' ').slice(0, 500))
  }

  console.log('\n=== SMOKE: askGrounded ===')
  let askOk = false
  try {
    const promptBody = listPrompts().find((p) => p.id === prompt.id)?.body
    const result = await askGrounded({
      question: 'What does Gorgias claim rhetoric is?',
      filters: { project: PROJECT },
      limit: 10,
      systemExtra: promptBody,
    })
    console.log('offline', !!result.offline, 'error', result.error || '')
    console.log('answer excerpt:')
    console.log((result.answer || '').slice(0, 800))
    console.log(
      'citations:',
      (result.citations || []).map((c) => `${c.id}:${c.title}`).join(' | ')
    )
    const citeIds = new Set((result.citations || []).map((c) => c.id))
    const createdIds = new Set(created.map((c) => c.id))
    const realCites = [...citeIds].filter((id) => createdIds.has(id))
    console.log(
      'citations look real (in Gorgias notes):',
      realCites.length,
      '/',
      citeIds.size
    )
    askOk = !result.offline && !result.error && (result.answer || '').length > 40
  } catch (e) {
    console.log('askGrounded FAILED:', e instanceof Error ? e.message : e)
  }

  console.log('\n=== SMOKE: chat as Callicles (persona) ===')
  try {
    const session = createSession({
      mode: 'grounded',
      title: 'Gorgias — Callicles smoke',
      filters: { project: PROJECT },
    })
    const chatInput = {
      sessionId: session.id,
      text: 'Talk briefly as Callicles about who should rule, using only the dialogue.',
      promptId: prompt.id,
      filters: { project: PROJECT },
      limit: 10,
    }
    let chat = await sendChatTurn(chatInput)
    if (chat.error && /429|rate.?limit|too many requests/i.test(chat.error)) {
      console.log('Rate limited; waiting once before retry')
      await new Promise((resolve) => setTimeout(resolve, 5000))
      chat = await sendChatTurn(chatInput)
    }
    console.log('offline', !!chat.offline, 'error', chat.error || '')
    console.log('assistant excerpt:')
    console.log((chat.assistant.content || '').slice(0, 800))
    console.log(
      'citations:',
      (JSON.parse(chat.assistant.citations_json || '[]') as Array<{ id: string; title: string }>)
        .map((c) => `${c.id}:${c.title}`)
        .join(' | ')
    )
    console.log('session', session.id)
  } catch (e) {
    console.log('chat FAILED:', e instanceof Error ? e.message : e)
  }

  console.log('\n=== SUMMARY ===')
  console.log(
    JSON.stringify(
      {
        notesCreated: created.length,
        sampleTitles: created.slice(0, 5).map((c) => c.title),
        promptId: prompt.id,
        promptName: prompt.name,
        askOk,
        project: PROJECT,
      },
      null,
      2
    )
  )

  closeDb()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
