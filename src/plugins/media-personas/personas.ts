/**
 * Media voices — grounded voice packs for Media chat.
 * Canonical prompt bodies live in electron/media-persona-defs.ts (seeded via IPC).
 */
export {
  MEDIA_PERSONAS,
  MEDIA_HARD_RULES,
  MEDIA_VOICE_PACK_DESC_PREFIX,
  buildMediaVoicePromptBody,
  getMediaPersonaByName,
  getMediaPersonaById,
  type MediaPersonaDef,
  type MediaPersonaId,
} from '../../../electron/media-persona-defs'

/** Display blurb for the plugin panel. */
export const MEDIA_PERSONAS_BLURB =
  'Reusable grounded voice packs for Media chat — they work with any ingested media (you do not create one voice per video). Each pack is a Vault Personality that keeps the hard Media rules (answer only from transcript notes, cite [itm_…], mention times when useful, say you don’t know when unsupported). Style never overrides grounding. Install once, then pick them as voice chips in Media chat.'
