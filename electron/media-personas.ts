/**
 * Seed / refresh Media persona Personality prompts + optional project-bound profiles.
 * Easy Add custom personas share the same grounding rules via buildMediaVoicePromptBody.
 */
import fs from 'fs'
import path from 'path'
import {
  createChatProfile,
  createPrompt,
  listChatProfiles,
  listPrompts,
  updateChatProfile,
  updatePrompt,
} from './db'
import {
  MEDIA_PERSONAS,
  MEDIA_VOICE_PACK_DESC_PREFIX,
  buildCustomMediaVoicePackDescription,
  buildMediaVoicePromptBody,
  getMediaPersonaByName,
  isCustomMediaVoicePackDescription,
  type MediaPersonaDef,
} from './media-persona-defs'
import type { ChatProfile, MediaVoicePackInfo, Prompt } from './types'

export type { MediaVoicePackInfo }

export {
  MEDIA_PERSONAS,
  MEDIA_HARD_RULES,
  MEDIA_VOICE_PACK_DESC_PREFIX,
  buildMediaVoicePromptBody,
  buildCustomMediaVoicePackDescription,
  getMediaPersonaByName,
  getMediaPersonaById,
  isCustomMediaVoicePackDescription,
  type MediaPersonaDef,
  type MediaPersonaId,
} from './media-persona-defs'

export interface EnsureMediaPersonasResult {
  prompts: Prompt[]
  created: string[]
  updated: string[]
}

export interface ApplyMediaPersonaInput {
  /** Persona name (e.g. "Desk cohost"), id (e.g. "desk-cohost"), or custom voice-pack name */
  persona: string
  project: string
  /** Optional display label for the profile name; defaults to project */
  displayTitle?: string
}

export interface ApplyMediaPersonaResult {
  persona: { name: string; id?: string; description: string; body: string }
  prompt: Prompt
  profile: ChatProfile
}

export interface CreateCustomMediaPersonaInput {
  name: string
  speakingStyle: string
  description?: string | null
}

export interface CreateCustomMediaPersonaResult {
  promptId: string
  name: string
}

/** Optional JSON registry of custom voice packs under userData (supplement to description prefix). */
interface VoicePackRegistryEntry {
  name: string
  promptId: string
  speakingStyle: string
  description?: string
  updatedAt: string
}

interface VoicePackRegistry {
  packs: VoicePackRegistryEntry[]
}

let registryPathOverride: string | null = null

export function setMediaVoicePackRegistryPath(dirOrNull: string | null): void {
  registryPathOverride = dirOrNull
}

function registryFilePath(): string {
  if (registryPathOverride) {
    return path.join(registryPathOverride, 'media-voice-packs.json')
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as typeof import('electron')
    const dir = electron.app.getPath('userData')
    return path.join(dir, 'media-voice-packs.json')
  } catch {
    return path.join('/tmp', 'lkv-media-voice-packs.json')
  }
}

function readRegistry(): VoicePackRegistry {
  try {
    const p = registryFilePath()
    if (!fs.existsSync(p)) return { packs: [] }
    const raw = fs.readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw) as VoicePackRegistry
    if (!parsed || !Array.isArray(parsed.packs)) return { packs: [] }
    return parsed
  } catch {
    return { packs: [] }
  }
}

function writeRegistry(reg: VoicePackRegistry): void {
  const p = registryFilePath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(reg, null, 2), 'utf8')
}

function upsertRegistryEntry(entry: VoicePackRegistryEntry): void {
  const reg = readRegistry()
  const i = reg.packs.findIndex(
    (x) => x.name === entry.name || x.promptId === entry.promptId
  )
  if (i >= 0) reg.packs[i] = entry
  else reg.packs.push(entry)
  writeRegistry(reg)
}

function ensureOnePersona(def: MediaPersonaDef): { prompt: Prompt; created: boolean; updated: boolean } {
  const existing = listPrompts().find((p) => p.name === def.name)
  if (existing) {
    if (existing.body !== def.body || (existing.description ?? '') !== def.description) {
      const updated = updatePrompt(existing.id, {
        body: def.body,
        description: def.description,
      })!
      return { prompt: updated, created: false, updated: true }
    }
    return { prompt: existing, created: false, updated: false }
  }
  const created = createPrompt({
    name: def.name,
    body: def.body,
    description: def.description,
  })
  return { prompt: created, created: true, updated: false }
}

/** Match-by-name upsert for all three Media personas (like Media reader). */
export function ensureMediaPersonaPrompts(): EnsureMediaPersonasResult {
  const prompts: Prompt[] = []
  const created: string[] = []
  const updated: string[] = []
  for (const def of MEDIA_PERSONAS) {
    const r = ensureOnePersona(def)
    prompts.push(r.prompt)
    if (r.created) created.push(def.name)
    if (r.updated) updated.push(def.name)
  }
  return { prompts, created, updated }
}

function upsertPersonaProfile(
  personaName: string,
  project: string,
  promptId: string,
  displayTitle: string
): ChatProfile {
  const name = `${personaName} · ${displayTitle}`.slice(0, 80)
  const existing = listChatProfiles().find(
    (p) => p.prompt_id === promptId && (p.project ?? '').trim() === project.trim()
  )
  if (existing) {
    if (existing.name !== name) {
      return updateChatProfile(existing.id, { name, promptId, project })!
    }
    return existing
  }
  const byName = listChatProfiles().find((p) => p.name === name)
  if (byName) {
    return updateChatProfile(byName.id, { name, promptId, project })!
  }
  return createChatProfile({ name, promptId, project })
}

function findCustomVoicePackPrompt(persona: string): Prompt | undefined {
  const n = persona.trim()
  const prompts = listPrompts()
  const byName = prompts.find((p) => p.name === n && isCustomMediaVoicePackDescription(p.description))
  if (byName) return byName
  const reg = readRegistry()
  const entry = reg.packs.find((e) => e.name === n || e.promptId === n)
  if (entry) {
    const p = prompts.find((x) => x.id === entry.promptId || x.name === entry.name)
    if (p) return p
  }
  return undefined
}

/**
 * Ensure the persona prompt exists, then upsert a chat profile
 * named like `Desk cohost · <project>` bound to that prompt + project.
 * Works for built-ins and Easy Add custom voice packs.
 */
export function applyMediaPersona(input: ApplyMediaPersonaInput): ApplyMediaPersonaResult {
  const project = (input.project ?? '').trim()
  if (!project) {
    throw new Error('applyMediaPersona: project is required')
  }
  const displayTitle = (input.displayTitle ?? project).trim() || project

  const def = getMediaPersonaByName(input.persona)
  if (def) {
    const { prompt } = ensureOnePersona(def)
    const profile = upsertPersonaProfile(def.name, project, prompt.id, displayTitle)
    return { persona: def, prompt, profile }
  }

  const custom = findCustomVoicePackPrompt(input.persona)
  if (!custom) {
    throw new Error(`Unknown Media persona: ${input.persona}`)
  }
  const profile = upsertPersonaProfile(custom.name, project, custom.id, displayTitle)
  return {
    persona: {
      name: custom.name,
      description: custom.description ?? '',
      body: custom.body,
    },
    prompt: custom,
    profile,
  }
}

/**
 * Easy Add: create or update a custom Media voice pack Personality (match-by-name).
 * Body = shared Media grounding rules + user speaking style.
 */
export function createCustomMediaPersona(
  input: CreateCustomMediaPersonaInput
): CreateCustomMediaPersonaResult {
  const name = (input.name ?? '').trim()
  const speakingStyle = (input.speakingStyle ?? '').trim()
  if (!name) throw new Error('createCustomMediaPersona: name is required')
  if (!speakingStyle) throw new Error('createCustomMediaPersona: speakingStyle is required')

  // Don't overwrite built-in names via Easy Add
  if (MEDIA_PERSONAS.some((p) => p.name === name || p.id === name)) {
    throw new Error(
      `“${name}” is a built-in Media persona. Choose a different name for a custom voice pack.`
    )
  }

  const description = buildCustomMediaVoicePackDescription(input.description)
  const body = buildMediaVoicePromptBody(speakingStyle, {
    roleLine: `You are ${name} — a custom Media chat voice for Vault Media chat.`,
  })

  const existing = listPrompts().find((p) => p.name === name)
  let prompt: Prompt
  if (existing) {
    prompt = updatePrompt(existing.id, { body, description })!
  } else {
    prompt = createPrompt({ name, body, description })
  }

  upsertRegistryEntry({
    name,
    promptId: prompt.id,
    speakingStyle,
    description: (input.description ?? '').trim() || undefined,
    updatedAt: new Date().toISOString(),
  })

  return { promptId: prompt.id, name: prompt.name }
}

/** Built-in + custom Media voice packs (for chips / personas panel). */
export function listMediaVoicePacks(): MediaVoicePackInfo[] {
  ensureMediaPersonaPrompts()
  const prompts = listPrompts()
  const reg = readRegistry()
  const out: MediaVoicePackInfo[] = []

  for (const def of MEDIA_PERSONAS) {
    const p = prompts.find((x) => x.name === def.name)
    if (p) {
      out.push({
        name: def.name,
        promptId: p.id,
        description: def.description,
        builtin: true,
      })
    }
  }

  const seen = new Set(out.map((x) => x.promptId))
  // Custom: description prefix and/or registry
  for (const p of prompts) {
    if (seen.has(p.id)) continue
    if (!isCustomMediaVoicePackDescription(p.description)) continue
    const entry = reg.packs.find((e) => e.promptId === p.id || e.name === p.name)
    out.push({
      name: p.name,
      promptId: p.id,
      description: p.description ?? MEDIA_VOICE_PACK_DESC_PREFIX,
      builtin: false,
      speakingStyle: entry?.speakingStyle,
    })
    seen.add(p.id)
  }

  // Registry-only orphans (prompt may have lost prefix — still list if prompt exists)
  for (const entry of reg.packs) {
    if (seen.has(entry.promptId)) continue
    const p = prompts.find((x) => x.id === entry.promptId || x.name === entry.name)
    if (!p) continue
    out.push({
      name: p.name,
      promptId: p.id,
      description: p.description ?? MEDIA_VOICE_PACK_DESC_PREFIX,
      builtin: false,
      speakingStyle: entry.speakingStyle,
    })
    seen.add(p.id)
  }

  return out
}

/** List only custom (non-built-in) Media voice-pack prompts. */
export function listCustomMediaPersonas(): MediaVoicePackInfo[] {
  return listMediaVoicePacks().filter((p) => !p.builtin)
}
