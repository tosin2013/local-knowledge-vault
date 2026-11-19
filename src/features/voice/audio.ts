/**
 * Browser audio for voice study (#413): the microphone (raw samples plus a level
 * per frame for turn detection) and spoken replies (the speech provider's WAV,
 * or the operating system's voices through the Web Speech API).
 */
import type { VoiceSettings, VoiceStatus } from '../../../electron/types'
import { downsample, encodeWav, rms } from './speech'

/** Why the microphone couldn't start, in plain words. */
export function micErrorMessage(err: unknown, snap: boolean): string {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return snap
      ? 'Vault can’t use the microphone. In a terminal, run: sudo snap connect local-knowledge-vault:audio-record, then try again. You can keep typing.'
      : 'Vault can’t use the microphone. Allow microphone access for Vault in your system settings, then try again. You can keep typing.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Plug one in, or keep typing.'
  return `The microphone didn’t start${err instanceof Error && err.message ? `: ${err.message}` : ''}. You can keep typing.`
}

export interface MicCapture {
  /** Stop listening and return the recording as a 16 kHz mono WAV (null when nothing was captured). */
  stop: () => Promise<Uint8Array | null>
  /** Stop without keeping the audio. */
  cancel: () => void
}

/** Start the microphone. `onLevel` gets the RMS level of each ~85 ms frame. */
export async function startMic(onLevel?: (level: number, now: number) => void): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  const Ctx = window.AudioContext
  const ctx = new Ctx()
  const source = ctx.createMediaStreamSource(stream)
  // ScriptProcessor is deprecated but synchronous and dependency-free; an
  // AudioWorklet would need a separate module file in the build.
  const node = ctx.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  let open = true
  node.onaudioprocess = (e: AudioProcessingEvent) => {
    if (!open) return
    const frame = new Float32Array(e.inputBuffer.getChannelData(0))
    chunks.push(frame)
    onLevel?.(rms(frame), performance.now())
  }
  source.connect(node)
  node.connect(ctx.destination)
  const close = () => {
    open = false
    try {
      node.disconnect()
      source.disconnect()
    } catch {
      /* already disconnected */
    }
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => undefined)
  }
  return {
    stop: async () => {
      const rate = ctx.sampleRate
      close()
      const total = chunks.reduce((n, c) => n + c.length, 0)
      if (!total) return null
      const all = new Float32Array(total)
      let at = 0
      for (const c of chunks) {
        all.set(c, at)
        at += c.length
      }
      return encodeWav(downsample(all, rate, 16000), Math.min(rate, 16000))
    },
    cancel: close,
  }
}

export interface Utterance {
  /** Resolves when the speech ends, is stopped, or fails. */
  done: Promise<void>
  stop: () => void
}

const noop: Utterance = { done: Promise.resolve(), stop: () => undefined }

/** OS voices through the Web Speech API, matched by name when one is chosen. */
export function speakWithSystem(text: string, voiceName = '', rate = 1): Utterance {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined' || !text.trim()) return noop
  const u = new SpeechSynthesisUtterance(text)
  const voice = voiceName ? synth.getVoices().find((v) => v.name === voiceName) : undefined
  if (voice) u.voice = voice
  if (rate !== 1) u.rate = rate
  const done = new Promise<void>((resolve) => {
    u.onend = () => resolve()
    u.onerror = () => resolve()
  })
  synth.speak(u)
  return { done, stop: () => synth.cancel() }
}

/** Play WAV bytes from the speech provider. */
export function playWav(bytes: Uint8Array): Utterance {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }))
  const audio = new Audio(url)
  let finish: () => void = () => undefined
  const done = new Promise<void>((resolve) => {
    finish = () => {
      URL.revokeObjectURL(url)
      resolve()
    }
  })
  audio.onended = finish
  audio.onerror = finish
  audio.play().catch(finish)
  return {
    done,
    stop: () => {
      audio.pause()
      finish()
    },
  }
}

/** Whether replies should come from the speech provider rather than the OS voices. */
export function providerVoiceReady(settings: VoiceSettings, status: VoiceStatus | null): boolean {
  return settings.output === 'provider' && !!status?.canSpeak
}

/**
 * One spoken reply: the provider voice when it's available, otherwise (or when
 * the provider call fails) the system voice. `onFallback` hears why.
 */
export function speakText(
  text: string,
  settings: VoiceSettings,
  status: VoiceStatus | null,
  onFallback?: (reason: string) => void
): Utterance {
  if (!text.trim()) return noop
  if (!providerVoiceReady(settings, status) || !window.lkv?.voice?.speak) {
    return speakWithSystem(text, settings.output === 'system' ? settings.voice : '')
  }
  let stopped = false
  let inner: Utterance | null = null
  const done = (async () => {
    const res = await window.lkv.voice.speak(text)
    if (stopped) return
    if (res.ok) inner = playWav(res.audio)
    else {
      onFallback?.(res.error)
      inner = speakWithSystem(text)
    }
    await inner.done
  })()
  return {
    done,
    stop: () => {
      stopped = true
      inner?.stop()
    },
  }
}

/**
 * Speak sentences one after another, fetching the next sentence's audio while
 * the current one plays, so a long reply starts talking after its first sentence.
 */
export function speakSentences(
  sentences: string[],
  settings: VoiceSettings,
  status: VoiceStatus | null,
  onFallback?: (reason: string) => void,
  /** System voices only: below 1 is slower ("slower" in Teach mode). Provider voices have no speed setting. */
  rate = 1
): Utterance {
  let stopped = false
  let current: Utterance | null = null
  const provider = providerVoiceReady(settings, status) && !!window.lkv?.voice?.speak
  const done = (async () => {
    if (!provider) {
      for (const s of sentences) {
        if (stopped) return
        current = speakWithSystem(s, settings.output === 'system' ? settings.voice : '', rate)
        await current.done
      }
      return
    }
    let next = sentences.length ? window.lkv.voice.speak(sentences[0]) : null
    for (let i = 0; i < sentences.length && next; i++) {
      const res = await next
      next = i + 1 < sentences.length ? window.lkv.voice.speak(sentences[i + 1]) : null
      if (stopped) return
      if (res.ok) current = playWav(res.audio)
      else {
        onFallback?.(res.error)
        current = speakWithSystem(sentences[i])
      }
      await current.done
    }
  })()
  return {
    done,
    stop: () => {
      stopped = true
      current?.stop()
    },
  }
}

/** OS voice names (they load asynchronously in Chromium). */
export function systemVoiceNames(): string[] {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined
  if (!synth) return []
  return [...new Set(synth.getVoices().map((v) => v.name).filter(Boolean))]
}
