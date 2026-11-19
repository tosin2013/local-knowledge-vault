/**
 * Voice study (#413): a small client for OpenAI-compatible audio routes.
 *
 *   POST {base}/v1/audio/transcriptions   speech to text (Ollama: `lfm3-audio`)
 *   POST {base}/v1/audio/speech           text to speech (Ollama: `phonon` + a voice)
 *
 * Ollama is the default and runs on this computer. Any other OpenAI-compatible
 * provider the user has added goes through the same code path; the settings mark
 * a cloud provider so the user knows audio would leave the machine.
 *
 * Settings live in `lkv-voice-settings.json` in userData. Keys stay in the main
 * process (provider-store) and never reach the renderer.
 */
import fs from 'fs'
import path from 'path'
import { resolveUserDataDir } from './user-data'
import { getProviderConfig, getProviderKey, listProviderConfigs } from './provider-store'
import { joinUrl, readErrorDetail, redactError } from './providers/http'
import type {
  ProviderConfig,
  VoiceProviderOption,
  VoicePullProgress,
  VoiceSettings,
  VoiceSpeakResult,
  VoiceStatus,
  VoiceTranscribeResult,
} from './types'

const SETTINGS_FILE = 'lkv-voice-settings.json'
export const DEFAULT_STT_MODEL = 'lfm3-audio'
export const DEFAULT_TTS_MODEL = 'phonon'
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: false,
  spokenReplies: true,
  providerId: 'ollama',
  sttModel: DEFAULT_STT_MODEL,
  ttsModel: DEFAULT_TTS_MODEL,
  output: 'provider',
  voice: '',
}
/** Ollama's `/v1/audio/speech` takes up to 4,096 characters per request. */
export const SPEECH_CHUNK_CHARS = 4000
/** Recordings are short spoken answers; 25 MB of 16 kHz mono WAV is over 13 minutes. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const STATUS_TIMEOUT_MS = 4000
const AUDIO_TIMEOUT_MS = 120_000

type FetchLike = typeof fetch

export interface VoiceDeps {
  fetchImpl?: FetchLike
  /** Defaults to the SNAP environment variable. */
  isSnap?: boolean
  timeoutMs?: number
}

/**
 * Phonon's 40M checkpoints are licensed CC BY-NC (non-commercial), so Vault only
 * uses the Apache-2.0 `phonon`. Matches `phonon-40m`, `phonon:40m`, `phonon_40M-en` …
 */
export function isNonCommercialSpeechModel(model: string): boolean {
  return /(^|[-_:./])40m($|[-_:./])/i.test((model ?? '').trim())
}

function cleanModel(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s || s.length > 200 || /\s/.test(s)) return fallback
  return s
}

/** Validate a stored or incoming settings object. Pure. */
export function sanitizeVoiceSettings(raw: Partial<VoiceSettings> | null | undefined, base: VoiceSettings = DEFAULT_VOICE_SETTINGS): VoiceSettings {
  const r = raw ?? {}
  const providerId = typeof r.providerId === 'string' && r.providerId.trim() ? r.providerId.trim().slice(0, 200) : base.providerId
  let ttsModel = cleanModel(r.ttsModel, base.ttsModel)
  if (isNonCommercialSpeechModel(ttsModel)) ttsModel = DEFAULT_TTS_MODEL
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : base.enabled,
    spokenReplies: typeof r.spokenReplies === 'boolean' ? r.spokenReplies : base.spokenReplies,
    providerId,
    sttModel: cleanModel(r.sttModel, base.sttModel),
    ttsModel,
    output: r.output === 'system' || r.output === 'provider' ? r.output : base.output,
    voice: typeof r.voice === 'string' ? r.voice.trim().slice(0, 200) : base.voice,
  }
}

function settingsPath(): string {
  return path.join(resolveUserDataDir(), SETTINGS_FILE)
}

export function getVoiceSettings(): VoiceSettings {
  try {
    return sanitizeVoiceSettings(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as Partial<VoiceSettings>)
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS }
  }
}

export function setVoiceSettings(patch: Partial<VoiceSettings>): VoiceSettings {
  const next = sanitizeVoiceSettings(patch, getVoiceSettings())
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

/* ---- Provider resolution ---- */

export interface AudioTarget {
  id: string
  label: string
  /** Ends with `/v1`: the OpenAI-compatible root. */
  apiBase: string
  /** The provider's own base URL (Ollama's native API lives here). */
  baseUrl: string
  ollama: boolean
  local: boolean
  apiKey: string | null
}

/** Providers that can serve OpenAI-compatible audio routes (Anthropic cannot). */
export function voiceProviderOptions(list: ProviderConfig[] = listProviderConfigs()): VoiceProviderOption[] {
  return list
    .filter((p) => p.kind === 'ollama' || p.kind === 'openai-compatible')
    .map((p) => ({ id: p.id, label: p.label, local: p.local }))
}

export function resolveAudioTarget(
  providerId: string,
  lookup: (id: string) => ProviderConfig | undefined = getProviderConfig,
  keyFor: (id: string, presetId?: string) => string | null = getProviderKey
): AudioTarget | null {
  const p = lookup(providerId)
  if (!p || (p.kind !== 'ollama' && p.kind !== 'openai-compatible')) return null
  const ollama = p.kind === 'ollama'
  const baseUrl = p.baseUrl.replace(/\/+$/, '')
  const apiBase = ollama || !/\/v\d+$/.test(baseUrl) ? joinUrl(baseUrl, '/v1') : baseUrl
  return { id: p.id, label: p.label, apiBase, baseUrl, ollama, local: p.local, apiKey: keyFor(p.id, p.presetId) }
}

function authHeaders(t: AudioTarget): Record<string, string> {
  return t.apiKey ? { Authorization: `Bearer ${t.apiKey}` } : {}
}

async function timed(fetchImpl: FetchLike, url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error(`Timed out after ${Math.round(ms / 1000)}s`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function errText(err: unknown): string {
  return redactError(err instanceof Error ? err.message : String(err))
}

/** `phonon` matches an installed `phonon:latest`; `lfm3-audio:2b` matches exactly. */
export function hasModel(installed: string[], model: string): boolean {
  const want = model.trim().toLowerCase()
  return installed.some((n) => {
    const name = n.toLowerCase()
    return name === want || name === `${want}:latest` || (!want.includes(':') && name.startsWith(`${want}:`))
  })
}

/* ---- Status ---- */

export async function voiceStatus(settings: VoiceSettings = getVoiceSettings(), deps: VoiceDeps = {}): Promise<VoiceStatus> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const snap = deps.isSnap ?? !!process.env.SNAP
  const providers = voiceProviderOptions()
  const target = resolveAudioTarget(settings.providerId)
  const base: VoiceStatus = {
    providerId: settings.providerId,
    providerLabel: target?.label ?? settings.providerId,
    local: target?.local ?? true,
    ollama: target?.ollama ?? false,
    reachable: false,
    canTranscribe: false,
    canSpeak: false,
    sttModel: settings.sttModel,
    ttsModel: settings.ttsModel,
    voices: [],
    snap,
    providers,
  }
  if (!target) {
    return { ...base, sttHint: 'Pick a provider for speech in Settings → Voice. Until then, type your answers.' }
  }
  const ms = deps.timeoutMs ?? STATUS_TIMEOUT_MS
  if (target.ollama) {
    let installed: string[]
    try {
      const res = await timed(fetchImpl, joinUrl(target.baseUrl, '/api/tags'), { headers: authHeaders(target) }, ms)
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
      const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> }
      installed = (data.models ?? []).map((m) => String(m.name ?? m.model ?? '')).filter(Boolean)
    } catch {
      return {
        ...base,
        sttHint: 'Ollama isn’t running, so Vault can’t hear you yet. Start Ollama, or type your answers.',
        ttsHint: 'Spoken replies use your computer’s built-in voices until Ollama is running.',
      }
    }
    const canTranscribe = hasModel(installed, settings.sttModel)
    const canSpeak = hasModel(installed, settings.ttsModel)
    let voices: string[] = []
    if (canSpeak) voices = await ollamaVoices(target, settings.ttsModel, fetchImpl, ms)
    return {
      ...base,
      reachable: true,
      canTranscribe,
      canSpeak,
      voices,
      ...(canTranscribe
        ? {}
        : { sttHint: `To answer out loud, download the speech-to-text model: ollama pull ${settings.sttModel}. You can keep typing meanwhile.` }),
      ...(canSpeak
        ? {}
        : {
            ttsHint: `Spoken replies use your computer’s built-in voices. For Ollama voices, download ${settings.ttsModel} (ollama pull ${settings.ttsModel}); Ollama currently runs it on Apple Silicon Macs.`,
          }),
    }
  }
  // Another OpenAI-compatible provider: there is no standard way to ask which audio
  // models it serves, so check it answers and let the first real call report errors.
  try {
    const res = await timed(fetchImpl, joinUrl(target.apiBase, '/models'), { headers: authHeaders(target) }, ms)
    const reachable = res.ok
    return {
      ...base,
      reachable,
      canTranscribe: reachable,
      canSpeak: reachable,
      ...(reachable ? {} : { sttHint: `${target.label} answered HTTP ${res.status}. Check the provider in Settings, or type your answers.` }),
    }
  } catch {
    return { ...base, sttHint: `Vault couldn’t reach ${target.label}. Type your answers, or pick another provider for speech.` }
  }
}

/** Voice names from Ollama's `/api/show` (`voices`); empty when it lists none. */
export async function ollamaVoices(t: AudioTarget, model: string, fetchImpl: FetchLike = fetch, ms = STATUS_TIMEOUT_MS): Promise<string[]> {
  try {
    const res = await timed(
      fetchImpl,
      joinUrl(t.baseUrl, '/api/show'),
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(t) }, body: JSON.stringify({ model }) },
      ms
    )
    if (!res.ok) return []
    const data = (await res.json()) as { voices?: unknown }
    const raw = Array.isArray(data.voices) ? data.voices : []
    const names = raw
      .map((v) => (typeof v === 'string' ? v : v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string' ? (v as { name: string }).name : ''))
      .map((s) => s.trim())
      .filter(Boolean)
    return [...new Set(names)].slice(0, 200)
  } catch {
    return []
  }
}

/* ---- Speech to text ---- */

export async function transcribe(
  audio: Uint8Array | ArrayBuffer,
  settings: VoiceSettings = getVoiceSettings(),
  deps: VoiceDeps = {}
): Promise<VoiceTranscribeResult> {
  const bytes = audio instanceof Uint8Array ? audio : new Uint8Array(audio ?? new ArrayBuffer(0))
  if (!bytes.byteLength) return { ok: false, error: 'Vault didn’t hear anything. Try again a little closer to the mic.' }
  if (bytes.byteLength > MAX_AUDIO_BYTES) return { ok: false, error: 'That recording is too long. Keep spoken answers under a few minutes.' }
  const target = resolveAudioTarget(settings.providerId)
  if (!target) return { ok: false, error: 'No speech provider is set up. Pick one in Settings → Voice.' }
  const form = new FormData()
  form.append('model', settings.sttModel)
  form.append('response_format', 'json')
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }), 'answer.wav')
  try {
    const res = await timed(
      deps.fetchImpl ?? fetch,
      joinUrl(target.apiBase, '/audio/transcriptions'),
      { method: 'POST', headers: authHeaders(target), body: form },
      deps.timeoutMs ?? AUDIO_TIMEOUT_MS
    )
    if (!res.ok) {
      const detail = await readErrorDetail(res, target.label)
      if (res.status === 404 && target.ollama) {
        return { ok: false, error: `${detail}. Download the speech-to-text model with: ollama pull ${settings.sttModel}` }
      }
      return { ok: false, error: detail }
    }
    const raw = await res.text()
    let text = raw
    try {
      const body = JSON.parse(raw) as { text?: unknown }
      text = typeof body.text === 'string' ? body.text : ''
    } catch {
      /* response_format=text servers answer with the plain transcript */
    }
    return { ok: true, text: text.trim() }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

/* ---- Text to speech ---- */

/** Split text at paragraph, then sentence, then word breaks so each piece fits one request. Pure. */
export function splitForSpeech(text: string, max = SPEECH_CHUNK_CHARS): string[] {
  const out: string[] = []
  const push = (s: string) => {
    const t = s.trim()
    if (t) out.push(t)
  }
  let cur = ''
  const pieces = (text ?? '').split(/(?<=[.!?])\s+|\n{2,}/)
  for (const piece of pieces) {
    if (piece.length > max) {
      push(cur)
      cur = ''
      let rest = piece
      while (rest.length > max) {
        const cut = rest.lastIndexOf(' ', max)
        const at = cut > 0 ? cut : max
        push(rest.slice(0, at))
        rest = rest.slice(at)
      }
      cur = rest
      continue
    }
    if ((cur ? cur.length + 1 : 0) + piece.length > max) {
      push(cur)
      cur = piece
    } else {
      cur = cur ? `${cur} ${piece}` : piece
    }
  }
  push(cur)
  return out
}

export interface WavParts {
  /** The 16-byte `fmt ` payload. */
  fmt: Uint8Array
  data: Uint8Array
}

function ascii(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])
}

/**
 * Read a RIFF/WAVE buffer. Ollama streams WAV with the size fields set to the
 * maximum value (the length isn't known up front), so the data chunk runs to
 * the end of the buffer whenever its stated size is larger than what's there.
 */
export function parseWav(buf: Uint8Array): WavParts | null {
  if (buf.byteLength < 12 || ascii(buf, 0) !== 'RIFF' || ascii(buf, 8) !== 'WAVE') return null
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let at = 12
  let fmt: Uint8Array | null = null
  while (at + 8 <= buf.byteLength) {
    const id = ascii(buf, at)
    const size = view.getUint32(at + 4, true)
    const start = at + 8
    if (id === 'fmt ') fmt = buf.slice(start, start + Math.min(size, 16))
    if (id === 'data') {
      if (!fmt) return null
      const end = Math.min(buf.byteLength, start + size)
      return { fmt, data: buf.slice(start, end - ((end - start) % 2)) }
    }
    at = start + size + (size % 2)
  }
  return null
}

/** One WAV from several with the same format, with correct size fields. Pure. */
export function joinWavs(parts: Uint8Array[]): Uint8Array | null {
  const parsed = parts.map(parseWav)
  if (!parsed.length || parsed.some((p) => !p)) return null
  const fmt = parsed[0]!.fmt
  const dataLen = parsed.reduce((n, p) => n + p!.data.byteLength, 0)
  const out = new Uint8Array(44 + dataLen)
  const view = new DataView(out.buffer)
  const write = (at: number, s: string) => {
    for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i)
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + dataLen, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  out.set(fmt.slice(0, 16), 20)
  write(36, 'data')
  view.setUint32(40, dataLen, true)
  let at = 44
  for (const p of parsed) {
    out.set(p!.data, at)
    at += p!.data.byteLength
  }
  return out
}

export async function speak(
  text: string,
  settings: VoiceSettings = getVoiceSettings(),
  deps: VoiceDeps = {}
): Promise<VoiceSpeakResult> {
  const chunks = splitForSpeech(text)
  if (!chunks.length) return { ok: false, error: 'Nothing to say.' }
  if (isNonCommercialSpeechModel(settings.ttsModel)) {
    return { ok: false, error: 'The 40M speech models are licensed for non-commercial use only. Use phonon.' }
  }
  const target = resolveAudioTarget(settings.providerId)
  if (!target) return { ok: false, error: 'No speech provider is set up. Pick one in Settings → Voice.' }
  const wavs: Uint8Array[] = []
  try {
    for (const input of chunks) {
      const res = await timed(
        deps.fetchImpl ?? fetch,
        joinUrl(target.apiBase, '/audio/speech'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders(target) },
          body: JSON.stringify({
            model: settings.ttsModel,
            input,
            response_format: 'wav',
            ...(settings.voice ? { voice: settings.voice } : {}),
          }),
        },
        deps.timeoutMs ?? AUDIO_TIMEOUT_MS
      )
      if (!res.ok) return { ok: false, error: await readErrorDetail(res, target.label) }
      wavs.push(new Uint8Array(await res.arrayBuffer()))
    }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
  const audio = joinWavs(wavs)
  if (!audio) return { ok: false, error: `${target.label} didn’t return WAV audio.` }
  return { ok: true, audio, mime: 'audio/wav' }
}

/* ---- Model download (Ollama) ---- */

/**
 * Download a speech model through Ollama's `/api/pull`, reporting progress from
 * its NDJSON stream. Only the configured speech models can be pulled, and never
 * a non-commercial checkpoint.
 */
export async function pullSpeechModel(
  model: string,
  onProgress: (p: VoicePullProgress) => void,
  settings: VoiceSettings = getVoiceSettings(),
  deps: VoiceDeps = {}
): Promise<VoicePullProgress> {
  const name = (model ?? '').trim()
  const fail = (error: string): VoicePullProgress => {
    const p = { model: name, status: 'error', done: true, error }
    onProgress(p)
    return p
  }
  if (name !== settings.sttModel && name !== settings.ttsModel) return fail('Only the speech models in Settings → Voice can be downloaded here.')
  if (isNonCommercialSpeechModel(name)) return fail('The 40M speech models are licensed for non-commercial use only. Use phonon.')
  const target = resolveAudioTarget(settings.providerId)
  if (!target?.ollama) return fail('Downloading models works with Ollama only.')
  try {
    const res = await (deps.fetchImpl ?? fetch)(joinUrl(target.baseUrl, '/api/pull'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(target) },
      body: JSON.stringify({ model: name, stream: true }),
    })
    if (!res.ok || !res.body) return fail(await readErrorDetail(res, 'Ollama'))
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let last: VoicePullProgress = { model: name, status: 'starting' }
    const handle = (line: string): VoicePullProgress | null => {
      if (!line.trim()) return null
      let msg: { status?: unknown; completed?: unknown; total?: unknown; error?: unknown }
      try {
        msg = JSON.parse(line)
      } catch {
        return null
      }
      if (typeof msg.error === 'string') return fail(redactError(msg.error))
      const status = typeof msg.status === 'string' ? msg.status : last.status
      last = {
        model: name,
        status,
        ...(typeof msg.completed === 'number' ? { completed: msg.completed } : {}),
        ...(typeof msg.total === 'number' ? { total: msg.total } : {}),
        ...(status === 'success' ? { done: true } : {}),
      }
      onProgress(last)
      return last.done ? last : null
    }
    for (;;) {
      const { value, done } = await reader.read()
      if (value) buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = done ? '' : (lines.pop() ?? '')
      for (const line of lines) {
        const end = handle(line)
        if (end) return end
      }
      if (done) break
    }
    return fail('The download stopped before it finished.')
  } catch (err) {
    return fail(errText(err))
  }
}
