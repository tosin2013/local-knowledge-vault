/**
 * Personality pack — export and import a personality as a portable, versioned
 * JSON document (#164).
 *
 * Scope: export is **global** (the user's personality library). Chat-specific
 * evidence bundles stay in `citation-pack.ts`; the two are deliberately
 * separate. A personality changes only style — import validation below rejects
 * anything that is not a well-formed Vault personality, and the grounding
 * contract still wraps the imported body when it is used.
 */
import type { PersonalityPack, Prompt } from './types'

export const PERSONALITY_PACK_KIND = 'vault.personality' as const
export const PERSONALITY_PACK_VERSION = 1
export const PERSONALITY_NAME_MAX = 80
export const PERSONALITY_DESCRIPTION_MAX = 200
/** The body becomes `systemExtra`, merged after the grounding rules. Cap it. */
export const PERSONALITY_BODY_MAX = 4000

export function buildPersonalityPack(
  prompt: Pick<Prompt, 'name' | 'description' | 'body'>,
  exportedAt = new Date().toISOString()
): PersonalityPack {
  return {
    kind: PERSONALITY_PACK_KIND,
    version: PERSONALITY_PACK_VERSION,
    name: prompt.name.trim(),
    description: prompt.description ?? null,
    body: prompt.body,
    exportedAt,
  }
}

/** Pretty JSON with a trailing newline, ready to write or copy. */
export function serializePersonalityPack(
  prompt: Pick<Prompt, 'name' | 'description' | 'body'>,
  exportedAt?: string
): string {
  return `${JSON.stringify(buildPersonalityPack(prompt, exportedAt), null, 2)}\n`
}

/** `<slug>.personality.json`, safe for any OS path. */
export function personalityFileName(name: string): string {
  const slug = (name || 'personality')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `${slug || 'personality'}.personality.json`
}

export type ParsePersonalityPackResult =
  | { ok: true; pack: PersonalityPack }
  | { ok: false; error: string }

/**
 * Deny-by-default import: unknown kinds, future versions, missing or oversized
 * fields and non-string values are refused with a readable error. The caller
 * creates a new prompt; an imported file never overwrites an existing one.
 */
export function parsePersonalityPack(text: string): ParsePersonalityPackResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'That file is not a personality export.' }
  }
  const obj = raw as Record<string, unknown>
  if (obj.kind !== PERSONALITY_PACK_KIND) {
    return { ok: false, error: 'That file is not a Vault personality export.' }
  }
  if (typeof obj.version !== 'number' || !Number.isFinite(obj.version)) {
    return { ok: false, error: 'The export is missing a version.' }
  }
  if (obj.version > PERSONALITY_PACK_VERSION) {
    return {
      ok: false,
      error: `This personality was exported by a newer version of Vault (${obj.version}).`,
    }
  }
  const name = typeof obj.name === 'string' ? obj.name.trim() : ''
  const body = typeof obj.body === 'string' ? obj.body.trim() : ''
  if (!name) return { ok: false, error: 'The export has no name.' }
  if (!body) return { ok: false, error: 'The export has no instructions.' }
  if (name.length > PERSONALITY_NAME_MAX) {
    return { ok: false, error: `The name is longer than ${PERSONALITY_NAME_MAX} characters.` }
  }
  if (body.length > PERSONALITY_BODY_MAX) {
    return {
      ok: false,
      error: `The instructions are longer than ${PERSONALITY_BODY_MAX} characters.`,
    }
  }
  let description: string | null = null
  if (obj.description != null) {
    if (typeof obj.description !== 'string') {
      return { ok: false, error: 'The description must be text.' }
    }
    description = obj.description.trim().slice(0, PERSONALITY_DESCRIPTION_MAX) || null
  }
  return {
    ok: true,
    pack: {
      kind: PERSONALITY_PACK_KIND,
      version: obj.version,
      name,
      description,
      body,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
    },
  }
}
