import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  micErrorMessage,
  playWav,
  providerVoiceReady,
  speakSentences,
  speakText,
  speakWithSystem,
  startMic,
  systemVoiceNames,
} from '../../src/features/voice/audio'
import { VOICE_SETTINGS, makeVoiceStatus } from './lkv'

/** A fake Web Speech API: each utterance "ends" on the next tick. */
function installSpeech() {
  const spoken: string[] = []
  const synth = {
    speak: vi.fn((u: { text: string; onend?: () => void; onerror?: () => void }) => {
      spoken.push(u.text)
      setTimeout(() => (u.text === 'fail' ? u.onerror?.() : u.onend?.()), 0)
    }),
    cancel: vi.fn(),
    getVoices: vi.fn(() => [{ name: 'Samantha' }, { name: 'Daniel' }, { name: 'Samantha' }]),
  }
  ;(window as unknown as Record<string, unknown>).speechSynthesis = synth
  ;(globalThis as unknown as Record<string, unknown>).SpeechSynthesisUtterance = class {
    text: string
    voice: unknown = null
    onend?: () => void
    onerror?: () => void
    constructor(t: string) {
      this.text = t
    }
  }
  return { synth, spoken }
}

/** A fake <audio>: play() ends on the next tick (or rejects). */
function installAudio(reject = false) {
  const played: string[] = []
  class FakeAudio {
    onended?: () => void
    onerror?: () => void
    constructor(public src: string) {}
    play() {
      played.push(this.src)
      if (reject) return Promise.reject(new Error('blocked'))
      setTimeout(() => this.onended?.(), 0)
      return Promise.resolve()
    }
    pause = vi.fn()
  }
  ;(globalThis as unknown as Record<string, unknown>).Audio = FakeAudio
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
  return played
}

describe('voice audio (#413)', () => {
  beforeEach(() => {
    installSpeech()
    installAudio()
  })
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).speechSynthesis
  })

  it('explains microphone errors, with the snap plug when it applies', () => {
    expect(micErrorMessage({ name: 'NotAllowedError' }, true)).toMatch(/snap connect local-knowledge-vault:audio-record/)
    expect(micErrorMessage({ name: 'NotAllowedError' }, false)).toMatch(/system settings/)
    expect(micErrorMessage({ name: 'NotFoundError' }, false)).toMatch(/No microphone/)
    expect(micErrorMessage(new Error('weird'), false)).toMatch(/didn’t start: weird/)
    expect(micErrorMessage('x', false)).toMatch(/didn’t start\./)
  })

  it('speaks with system voices, matching a chosen name', async () => {
    const { synth, spoken } = installSpeech()
    await speakWithSystem('Hello', 'Daniel').done
    expect(spoken).toEqual(['Hello'])
    await speakWithSystem('fail').done
    const u = speakWithSystem('Bye')
    u.stop()
    expect(synth.cancel).toHaveBeenCalled()
    await speakWithSystem('  ').done
    expect(systemVoiceNames()).toEqual(['Samantha', 'Daniel'])
    delete (window as unknown as Record<string, unknown>).speechSynthesis
    expect(systemVoiceNames()).toEqual([])
    await speakWithSystem('no synth').done
  })

  it('plays provider WAV and stops it', async () => {
    await playWav(new Uint8Array([1])).done
    const u = playWav(new Uint8Array([1]))
    u.stop()
    await u.done
    installAudio(true)
    await playWav(new Uint8Array([1])).done
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('uses the provider voice only when it can speak', async () => {
    const status = makeVoiceStatus({ canSpeak: true })
    expect(providerVoiceReady(VOICE_SETTINGS, status)).toBe(true)
    expect(providerVoiceReady({ ...VOICE_SETTINGS, output: 'system' }, status)).toBe(false)
    expect(providerVoiceReady(VOICE_SETTINGS, null)).toBe(false)

    vi.mocked(window.lkv.voice.speak).mockResolvedValue({ ok: true, audio: new Uint8Array([1]), mime: 'audio/wav' })
    await speakText('Hi', VOICE_SETTINGS, status).done
    expect(window.lkv.voice.speak).toHaveBeenCalledWith('Hi')

    const fallback = vi.fn()
    vi.mocked(window.lkv.voice.speak).mockResolvedValue({ ok: false, error: 'down' })
    await speakText('Hi', VOICE_SETTINGS, status, fallback).done
    expect(fallback).toHaveBeenCalledWith('down')

    const u = speakText('Hi', VOICE_SETTINGS, status)
    u.stop()
    await u.done
    await speakText('', VOICE_SETTINGS, status).done
    await speakText('Hi', { ...VOICE_SETTINGS, output: 'system', voice: 'Daniel' }, status).done
  })

  it('speaks sentences in order, prefetching the next one', async () => {
    const status = makeVoiceStatus({ canSpeak: true })
    vi.mocked(window.lkv.voice.speak).mockResolvedValue({ ok: true, audio: new Uint8Array([1]), mime: 'audio/wav' })
    await speakSentences(['One.', 'Two.'], VOICE_SETTINGS, status).done
    expect(vi.mocked(window.lkv.voice.speak).mock.calls.map((c) => c[0])).toEqual(['One.', 'Two.'])

    const fallback = vi.fn()
    vi.mocked(window.lkv.voice.speak).mockResolvedValue({ ok: false, error: 'nope' })
    await speakSentences(['A.'], VOICE_SETTINGS, status, fallback).done
    expect(fallback).toHaveBeenCalledWith('nope')

    const stopped = speakSentences(['A.', 'B.'], VOICE_SETTINGS, status)
    stopped.stop()
    await stopped.done

    const { spoken } = installSpeech()
    await speakSentences(['X.', 'Y.'], VOICE_SETTINGS, makeVoiceStatus({ canSpeak: false })).done
    expect(spoken).toEqual(['X.', 'Y.'])
    const sys = speakSentences(['P.', 'Q.'], { ...VOICE_SETTINGS, output: 'system' }, null)
    sys.stop()
    await sys.done
    await speakSentences([], VOICE_SETTINGS, status).done
  })

  it('records the microphone into a 16 kHz WAV with levels', async () => {
    const stopTrack = vi.fn()
    const stream = { getTracks: () => [{ stop: stopTrack }] }
    let node: { onaudioprocess?: (e: unknown) => void; connect: () => void; disconnect: () => void } | null = null
    class FakeCtx {
      sampleRate = 48000
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() }
      }
      createScriptProcessor() {
        node = { connect: vi.fn(), disconnect: vi.fn() }
        return node
      }
      destination = {}
      close = vi.fn().mockResolvedValue(undefined)
    }
    ;(window as unknown as Record<string, unknown>).AudioContext = FakeCtx
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    })
    const levels: number[] = []
    const cap = await startMic((l) => levels.push(l))
    const frame = (v: number) => ({ inputBuffer: { getChannelData: () => new Float32Array(4800).fill(v) } })
    node!.onaudioprocess!(frame(0.5))
    node!.onaudioprocess!(frame(0.25))
    const wav = await cap.stop()
    expect(levels).toEqual([0.5, 0.25])
    expect(wav!.byteLength).toBe(44 + 3200 * 2)
    expect(new DataView(wav!.buffer).getUint32(24, true)).toBe(16000)
    expect(stopTrack).toHaveBeenCalled()
    node!.onaudioprocess!(frame(1)) // after stop: ignored
    expect(levels).toHaveLength(2)

    const empty = await startMic()
    expect(await empty.stop()).toBeNull()
    const cancelled = await startMic()
    node!.disconnect = () => {
      throw new Error('already')
    }
    cancelled.cancel()
  })
})
