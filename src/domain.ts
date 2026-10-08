import type { AnswerProvider, ChatProfile, Citation, Item, ItemFilters, Para, Prompt } from '../electron/types'

/** Primary content views: Ask (`chat`), Find (`search`), Study (`study`), plus Personalities (`prompts`). */
export type Mode = 'search' | 'chat' | 'study' | 'prompts'
export type UiMode = 'simple' | 'advanced'

export const PARA_OPTIONS: Array<Para | ''> = ['', 'projects', 'areas', 'resources', 'archives']
export const KIND_OPTIONS = ['', 'note', 'book', 'article', 'docs', 'blog', 'reference', 'transcript']
export const STATUS_OPTIONS = ['', 'active', 'archived']

export const PARA_LABELS: Record<string, string> = {
  projects: 'Projects',
  areas: 'Areas',
  resources: 'Resources',
  archives: 'Archive',
}

export const UI_MODE_KEY = 'lkv.uiMode'
export const THEME_KEY = 'lkv.theme'
export const LAST_PROFILE_KEY = 'lkv.lastProfile'

/** Built-in chat profiles: Personality + Project (+ optional bind). */
export type BuiltinChatProfileId = 'grounded-helper' | 'gorgias'
/** Builtins, Custom, or a user profile id (`prf_…`). */
export type ChatProfileId = BuiltinChatProfileId | 'custom' | string

export type LastProfileState = {
  profileId: ChatProfileId
  promptId: string
  project: string
}

export type BuiltinProfile = {
  id: BuiltinChatProfileId
  name: string
  /** Fixed prompt id when known (Gorgias reader). */
  promptId?: string
  /** Match seeded grounded prompt by name. */
  promptNames?: string[]
  project: string
}

export const BUILTIN_PROFILE_IDS: BuiltinChatProfileId[] = ['grounded-helper', 'gorgias']

export function isBuiltinProfileId(id: string): id is BuiltinChatProfileId {
  return (BUILTIN_PROFILE_IDS as string[]).includes(id)
}

export const BUILTIN_PROFILES: BuiltinProfile[] = [
  {
    id: 'grounded-helper',
    name: 'Grounded helper',
    promptNames: ['Grounded default', 'Grounded helper'],
    project: '',
  },
]

/** Legacy localStorage values: blink = dark, blink-light = light. */
export type ThemeMode = 'blink' | 'blink-light'

export function loadUiMode(): UiMode {
  try {
    const v = localStorage.getItem(UI_MODE_KEY)
    return v === 'advanced' ? 'advanced' : 'simple'
  } catch {
    return 'simple'
  }
}

export function loadTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'blink-light' ? 'blink-light' : 'blink'
  } catch {
    return 'blink'
  }
}

export function applyTheme(theme: ThemeMode) {
  const scheme = theme === 'blink-light' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-color-scheme', scheme)
  document.documentElement.style.colorScheme = scheme
}

export function paraLabel(para: string): string {
  return PARA_LABELS[para] ?? para
}

export const emptyFilters = (): ItemFilters => ({
  para: '',
  kind: '',
  status: '',
  project: '',
})

/** Local-only id for an unsaved new note (no DB row yet). */
export const NEW_DRAFT_ID = '__draft_new__'

/** A note saved from an AI answer/moment, not yet confirmed by the user. */
export const AI_DRAFT_STATUS = 'ai-draft'

export interface NoteProvenance {
  sourceUrl?: string
  tStart?: number
  tEnd?: number
  citedIds?: string[]
}

/**
 * Provenance header lines for a note saved from a source moment, written into
 * the note body using the same `source_url:` marker convention as media ingest
 * (`electron/media-ingest.ts`). Empty string when there is nothing to record.
 */
export function provenanceHeader(prov: NoteProvenance): string {
  const lines: string[] = []
  if (prov.sourceUrl) lines.push(`source_url: ${prov.sourceUrl}`)
  if (prov.tStart !== undefined) lines.push(`t_start: ${prov.tStart}`)
  if (prov.tEnd !== undefined) lines.push(`t_end: ${prov.tEnd}`)
  if (prov.citedIds?.length) lines.push(`cited: ${prov.citedIds.join(', ')}`)
  return lines.length ? `${lines.join('\n')}\n\n` : ''
}

export function isValidHttpUrl(raw: string): boolean {
  const s = raw.trim()
  if (!/^https?:\/\//i.test(s)) return false
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function makeNewDraftItem(): Item {
  const ts = new Date().toISOString()
  return {
    id: NEW_DRAFT_ID,
    title: '',
    summary: null,
    body: '',
    para: 'resources',
    kind: 'note',
    status: 'active',
    project: null,
    created_at: ts,
    updated_at: ts,
  }
}

export function parseCitations(json: string | null): Citation[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as Citation[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Which provider wrote an assistant message, or null for canned/legacy messages (#45). */
export function parseAnswerProvider(json: string | null | undefined): AnswerProvider | null {
  if (!json) return null
  try {
    const p = JSON.parse(json) as Partial<AnswerProvider> | null
    if (!p || typeof p.label !== 'string' || typeof p.local !== 'boolean') return null
    return {
      id: String(p.id ?? ''),
      label: p.label,
      model: String(p.model ?? ''),
      local: p.local,
      fallback: p.fallback === true,
    }
  } catch {
    return null
  }
}

/** A run of answer text, or a single inline citation that replaced a [itm_…] marker. */
export type InlineSegment =
  | { kind: 'text'; text: string }
  | { kind: 'citation'; number: number; citation: Citation }

/**
 * Split answer text so valid `[itm_…]` markers become numbered inline
 * citations ([1], [2], …) that map to the citation list, instead of rendering
 * as raw text (#129). Unknown markers are left as literal text (defensive —
 * the main process already strips hallucinations in #38).
 */
export function parseInlineCitations(content: string, citations: Citation[]): InlineSegment[] {
  const indexById = new Map<string, number>()
  citations.forEach((c, i) => indexById.set(c.id, i))

  const segments: InlineSegment[] = []
  const re = /\[(itm_[a-zA-Z0-9]+)\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) segments.push({ kind: 'text', text: content.slice(last, m.index) })
    const id = m[1]
    const idx = indexById.get(id)
    if (idx === undefined) {
      segments.push({ kind: 'text', text: m[0] })
    } else {
      segments.push({ kind: 'citation', number: idx + 1, citation: citations[idx] })
    }
    last = m.index + m[0].length
  }
  if (last < content.length) segments.push({ kind: 'text', text: content.slice(last) })

  // Coalesce adjacent text segments (e.g. unknown markers kept as literal text).
  const merged: InlineSegment[] = []
  for (const seg of segments) {
    const prev = merged[merged.length - 1]
    if (seg.kind === 'text' && prev && prev.kind === 'text') prev.text += seg.text
    else merged.push(seg)
  }
  return merged
}

export const GORGIAS_READER_PROMPT_ID = 'prm_56ba1ab41bfe4042'
export const GORGIAS_PROJECT = 'Gorgias'
export const GORGIAS_READER_NAME = 'Gorgias reader'
export const GROUNDED_DEFAULT_NAMES = ['Grounded default', 'Grounded helper']

/** Project the first-run self-documenting guide is seeded into (#163). */
export const VAULT_GUIDE_PROJECT = 'Vault guide'

/**
 * The Gorgias demo profile. It is not in BUILTIN_PROFILES because it must not
 * ship to every user (#126): it only appears once the "Gorgias reader" prompt
 * actually exists (i.e. the user ingested the Gorgias source).
 */
export const GORGIAS_PROFILE: BuiltinProfile = {
  id: 'gorgias',
  name: 'Gorgias',
  promptId: GORGIAS_READER_PROMPT_ID,
  promptNames: [GORGIAS_READER_NAME],
  project: GORGIAS_PROJECT,
}

/** Built-in profiles visible to this user: Gorgias only when its prompt is present. */
export function listBuiltinProfiles(prompts: Prompt[]): BuiltinProfile[] {
  const hasGorgias = prompts.some(
    (p) => p.id === GORGIAS_READER_PROMPT_ID || p.name === GORGIAS_READER_NAME
  )
  return hasGorgias ? [...BUILTIN_PROFILES, GORGIAS_PROFILE] : BUILTIN_PROFILES
}

export function isGorgiasReaderPrompt(promptId: string, prompts: Prompt[]): boolean {
  if (!promptId) return false
  if (promptId === GORGIAS_READER_PROMPT_ID) return true
  return prompts.some((p) => p.id === promptId && p.name === GORGIAS_READER_NAME)
}

export function findGroundedDefaultPrompt(prompts: Prompt[]): Prompt | undefined {
  return prompts.find((p) => GROUNDED_DEFAULT_NAMES.includes(p.name)) ?? prompts[0]
}

export function resolveProfilePromptId(profile: BuiltinProfile, prompts: Prompt[]): string | undefined {
  if (profile.promptId && prompts.some((p) => p.id === profile.promptId)) {
    return profile.promptId
  }
  if (profile.promptNames?.length) {
    const byName = prompts.find((p) => profile.promptNames!.includes(p.name))
    if (byName) return byName.id
  }
  if (profile.promptId) return profile.promptId
  return findGroundedDefaultPrompt(prompts)?.id
}

export function personalityDisplayName(p: Prompt): string {
  if (p.name === 'Grounded default') return 'Grounded helper'
  return p.name
}

export function titleFromFirstQuestion(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return 'New chat'
  const cut = cleaned.split(/[?!.\n]/)[0]?.trim() || cleaned
  const base = cut.length >= 12 ? cut : cleaned
  return base.length > 48 ? base.slice(0, 45).trimEnd() + '…' : base
}

export function askEmptyStateCopy(
  profileId: ChatProfileId,
  prompts: Prompt[],
  selectedPromptId: string,
  project: string,
  userProfiles: ChatProfile[] = [],
): { title: string; body: string } {
  const proj = (project ?? '').trim()
  if (
    profileId === 'gorgias' ||
    (proj === GORGIAS_PROJECT && isGorgiasReaderPrompt(selectedPromptId, prompts))
  ) {
    return {
      title: "You're talking with Gorgias",
      body: 'Answers come only from those notes.',
    }
  }
  if (profileId === 'grounded-helper') {
    if (proj === VAULT_GUIDE_PROJECT) {
      return {
        title: 'Ask about the Vault guide',
        body: 'Example: What is PARA? Answers come from the guide notes, with citations.',
      }
    }
    return {
      title: 'Ask anything grounded in your notes',
      body: 'Example: What did I write about habits?',
    }
  }
  const user = userProfiles.find((p) => p.id === profileId)
  if (user) {
    const prompt = prompts.find((p) => p.id === selectedPromptId)
    const persona = prompt ? personalityDisplayName(prompt) : 'missing personality'
    const scope = proj ? `notes from “${proj}”` : 'all notes'
    const broken = !prompt
    return {
      title: broken ? `${user.name} · personality missing` : user.name,
      body: broken
        ? 'This profile’s personality was deleted — pick another or delete the profile.'
        : `Answers use the “${persona}” personality and ${scope}.`,
    }
  }
  const prompt = prompts.find((p) => p.id === selectedPromptId)
  const name = prompt ? personalityDisplayName(prompt) : 'Custom'
  const scope = proj ? `notes from “${proj}”` : 'all notes'
  return {
    title: `Custom · ${name}`,
    body: `Answers use the “${name}” personality and ${scope}.`,
  }
}

export function matchProfileId(
  promptId: string,
  project: string,
  prompts: Prompt[],
  userProfiles: ChatProfile[] = [],
): ChatProfileId {
  const proj = (project ?? '').trim()
  for (const profile of listBuiltinProfiles(prompts)) {
    const resolved = resolveProfilePromptId(profile, prompts)
    if (!resolved || resolved !== promptId) continue
    if ((profile.project ?? '').trim() === proj) return profile.id
  }
  for (const profile of userProfiles) {
    if (profile.prompt_id === promptId && (profile.project ?? '').trim() === proj) {
      return profile.id
    }
  }
  return 'custom'
}

export function loadLastProfile(): LastProfileState | null {
  try {
    const raw = localStorage.getItem(LAST_PROFILE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LastProfileState>
    if (!parsed || typeof parsed !== 'object') return null
    const profileId = parsed.profileId
    if (typeof profileId !== 'string' || !profileId.trim()) return null
    // Builtins, custom, or user profile ids (e.g. prf_…)
    return {
      profileId,
      promptId: typeof parsed.promptId === 'string' ? parsed.promptId : '',
      project: typeof parsed.project === 'string' ? parsed.project : '',
    }
  } catch {
    return null
  }
}

export function saveLastProfile(state: LastProfileState) {
  try {
    localStorage.setItem(LAST_PROFILE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}
