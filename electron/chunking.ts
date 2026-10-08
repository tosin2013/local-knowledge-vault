/**
 * Pure note chunking (#219) — split a long note body into retrieval chunks.
 *
 * Sentence-aware greedy packing: sentences are grouped into chunks up to
 * `maxChars`; a sentence longer than `maxChars` is hard-split on word
 * boundaries. Kept free of DB/Electron imports so it can be smoke-tested
 * without a database.
 */

/** Target maximum characters per chunk. */
export const DEFAULT_CHUNK_CHARS = 800

/** A sentence followed by its terminator, or a trailing fragment with none. */
const SENTENCE_RE = /[^.!?]+[.!?]+\s*|[^.!?]+$/g

/** Hard-split a too-long run on word boundaries (no sentence markers found). */
function hardSplit(text: string, maxChars: number): string[] {
  const parts: string[] = []
  let rest = text.trim()
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(' ', maxChars)
    if (cut < Math.floor(maxChars / 2)) cut = maxChars
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

/**
 * Split text into chunks no longer than `maxChars`, preferring sentence
 * boundaries. Empty input yields no chunks; short input yields one chunk.
 */
export function splitIntoChunks(text: string, maxChars = DEFAULT_CHUNK_CHARS): string[] {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return []
  if (trimmed.length <= maxChars) return [trimmed]

  const sentences = trimmed.match(SENTENCE_RE) ?? [trimmed]
  const chunks: string[] = []
  let current = ''
  for (const raw of sentences) {
    const piece = raw.trim()
    if (!piece) continue
    if (current.length + piece.length + 1 <= maxChars) {
      current = current ? `${current} ${piece}` : piece
      continue
    }
    if (current) chunks.push(current)
    if (piece.length > maxChars) {
      for (const sub of hardSplit(piece, maxChars)) chunks.push(sub)
      current = ''
    } else {
      current = piece
    }
  }
  if (current) chunks.push(current)
  return chunks
}
