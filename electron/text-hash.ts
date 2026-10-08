import { createHash } from 'crypto'

/**
 * A short, stable fingerprint of a text (first 16 hex chars of SHA-1). Study
 * cards keep the hash of the note body and of the chunk they were made from,
 * so a later edit can be detected and the card's question regenerated (#263).
 * Not a security primitive.
 */
export function hashText(text: string): string {
  return createHash('sha1').update(text ?? '', 'utf8').digest('hex').slice(0, 16)
}
