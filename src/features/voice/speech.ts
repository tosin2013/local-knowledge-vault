/**
 * Pure helpers for voice study (#413): what gets read aloud, sentence splitting,
 * WAV encoding for the transcription route, turn detection for the hands-free
 * loop, and the few spoken words Vault listens for (grades, confidence, hints).
 */
import type { ReviewGrade, StudyCardQuestion } from '../../../electron/types'

/** Text to read aloud: no citation ids, markdown markers, links or bullets. The screen keeps the full text. */
export function speakableText(text: string): string {
  return (text ?? '')
    .replace(/\[itm_[^\]\s]*\]/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~>|]+/g, '')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Split text into sentences for sentence-by-sentence speech. Pure. */
export function splitSentences(text: string): string[] {
  const t = (text ?? '').trim()
  if (!t) return []
  return t
    .split(/(?<=[.!?…])\s+(?=[^\s])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Average-pool resample (good enough for speech going down to 16 kHz). Pure. */
export function downsample(samples: Float32Array, fromRate: number, toRate = 16000): Float32Array {
  if (!samples.length || fromRate <= toRate) return samples
  const ratio = fromRate / toRate
  const out = new Float32Array(Math.floor(samples.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += samples[j]
    out[i] = sum / Math.max(1, end - start)
  }
  return out
}

/** 16-bit PCM mono WAV. Pure. */
export function encodeWav(samples: Float32Array, sampleRate = 16000): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2)
  const v = new DataView(out.buffer)
  const w = (at: number, s: string) => {
    for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i)
  }
  w(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  w(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return out
}

/** Root-mean-square level of one audio frame (0…1). Pure. */
export function rms(frame: Float32Array): number {
  if (!frame.length) return 0
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  return Math.sqrt(sum / frame.length)
}

export type TurnState = 'waiting' | 'speaking' | 'done' | 'timeout'

export interface TurnDetectorOptions {
  /** RMS above this counts as speech (a function lets the caller raise it while Vault is talking). */
  threshold?: number | (() => number)
  /** Silence after speech that ends the turn. */
  silenceMs?: number
  /** Speech shorter than this is a cough or a click, not a turn. */
  minSpeechMs?: number
  /** Give up when nobody speaks for this long. */
  maxWaitMs?: number
  /** Hard cap on one turn. */
  maxTurnMs?: number
}

/**
 * Voice activity detection for the hands-free loop: feed it a level per audio
 * frame, and it says when the learner started talking and when they stopped.
 */
export function createTurnDetector(opts: TurnDetectorOptions = {}) {
  const threshold = opts.threshold ?? 0.02
  const level0 = () => (typeof threshold === 'function' ? threshold() : threshold)
  const silenceMs = opts.silenceMs ?? 1200
  const minSpeechMs = opts.minSpeechMs ?? 250
  const maxWaitMs = opts.maxWaitMs ?? 15000
  const maxTurnMs = opts.maxTurnMs ?? 60000
  let started: number | null = null
  let speechStart: number | null = null
  let lastVoice: number | null = null
  let state: TurnState = 'waiting'
  return {
    get state() {
      return state
    },
    step(level: number, now: number): TurnState {
      if (state === 'done' || state === 'timeout') return state
      if (started == null) started = now
      const voiced = level >= level0()
      if (state === 'waiting') {
        if (voiced) {
          if (speechStart == null) speechStart = now
          lastVoice = now
          if (now - speechStart >= minSpeechMs) state = 'speaking'
        } else {
          speechStart = null
          if (now - started >= maxWaitMs) state = 'timeout'
        }
        return state
      }
      if (voiced) lastVoice = now
      if (now - (lastVoice ?? now) >= silenceMs || now - (speechStart ?? now) >= maxTurnMs) state = 'done'
      return state
    },
  }
}

const norm = (t: string) => ` ${(t ?? '').toLowerCase().replace(/[^a-z0-9%\s]/g, ' ').replace(/\s+/g, ' ').trim()} `

/** A spoken self-grade ("got it", "partly", "missed"), or null. Pure. */
export function parseSpokenGrade(text: string): ReviewGrade | null {
  const t = norm(text)
  if (/ (missed|miss|wrong|no idea|didn t get|did not get|got it wrong|again) /.test(t)) return 'again'
  if (/ (partly|partially|part of it|sort of|kind of|half|hard) /.test(t)) return 'hard'
  if (/ (got it|right|correct|yes|good|nailed it) /.test(t)) return 'good'
  return null
}

const WORD_NUMBERS: Record<string, number> = {
  zero: 0, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
}

/** A spoken confidence ("about 70", "pretty sure", "no idea") as 0–100 in steps of 10, or null. Pure. */
export function parseSpokenConfidence(text: string): number | null {
  const t = norm(text)
  const num = /(\d{1,3})\s?(%|percent)?/.exec(t)
  const round = (n: number) => Math.max(0, Math.min(100, Math.round(n / 10) * 10))
  if (num) return round(Number(num[1]))
  for (const [w, n] of Object.entries(WORD_NUMBERS)) if (t.includes(` ${w} `)) return n
  if (/ (no idea|not sure at all|clueless|guess|guessing) /.test(t)) return 10
  if (/ (very sure|certain|definitely|totally sure|completely sure) /.test(t)) return 90
  if (/ (pretty sure|fairly sure|quite sure|confident) /.test(t)) return 70
  if (/ (not sure|unsure|maybe|kind of sure|somewhat) /.test(t)) return 40
  if (/ (sure) /.test(t)) return 70
  return null
}

export type SpokenCommand = 'hint' | 'dontKnow' | 'repeat' | 'skip' | 'stop'

/** A short spoken command, only when the whole utterance is the command. Pure. */
export function parseSpokenCommand(text: string): SpokenCommand | null {
  const t = norm(text).trim()
  if (/^(stop|stop talking|end|end session|that s all|goodbye|bye)$/.test(t)) return 'stop'
  if (/^((give me |can i (get|have) )?(a |another )?hint( please)?|help me|help)$/.test(t)) return 'hint'
  if (/^(i don t know|i do not know|no idea|dunno|pass)$/.test(t)) return 'dontKnow'
  if (/^(repeat|say (that|it) again|again please|what was the question|repeat the question)$/.test(t)) return 'repeat'
  if (/^(skip|next|skip (it|this one))$/.test(t)) return 'skip'
  return null
}

/**
 * Graduated hints for a Study card, Exam-tutor style (#364): first where to look,
 * then the answer's shape, then the supporting quote with the answer blanked.
 * Never the answer itself. Returns null when there's no further hint.
 */
export function studyHint(q: Pick<StudyCardQuestion, 'title' | 'answer' | 'quote' | 'sectionText'>, level: number): string | null {
  const answer = (q.answer ?? '').trim()
  if (level <= 1) return `Think about your note “${q.title}”.`
  if (level === 2 && answer) {
    const words = answer.split(/\s+/)
    return words.length > 1
      ? `The answer is ${words.length} words and starts with “${words[0].charAt(0).toUpperCase()}”.`
      : `The answer starts with “${answer.charAt(0).toUpperCase()}” and has ${answer.length} letters.`
  }
  if (level <= 3 && q.quote) {
    const blank = answer ? q.quote.replace(new RegExp(answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '___') : q.quote
    if (!answer || blank !== q.quote) return `Your note says: “${blank}”.`
  }
  return null
}
