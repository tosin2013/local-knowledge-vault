import { useCallback, useEffect, useRef, useState } from 'react'
import { speakSentences, type Utterance } from './audio'
import { speakableText, splitSentences } from './speech'
import { useMic, type MicPhase } from './useMic'
import { useVoice } from './useVoice'

export type TalkBusy = 'idle' | 'thinking' | 'speaking'

const DEFAULT_PAUSED_NOTICE =
  'Paused: I didn’t hear anything for a while. Press Start talking to carry on.'

export interface UseTalkLoopOptions {
  /** Shown when the mic hears nothing for a while and the loop pauses. */
  pausedNotice?: string
}

/**
 * The live status line for a Talk conversation: listening, transcribing,
 * thinking, speaking, or ready while the loop is still on.
 */
export function talkStatusText(phase: MicPhase, busy: TalkBusy, running: boolean): string {
  if (phase === 'listening') return busy === 'speaking' ? 'Speaking… talk to interrupt' : 'Listening…'
  if (phase === 'transcribing') return 'Writing down what you said…'
  if (busy === 'thinking') return 'Checking your notes…'
  if (busy === 'speaking') return 'Speaking…'
  return running ? 'Ready' : ''
}

/**
 * Shared hands-free Talk loop (#413, #426): listen → pause ends the turn →
 * `onTurn` → speak the reply → listen again, until Stop or the turn handler
 * ends the loop. Talking while Vault is speaking interrupts it.
 */
export function useTalkLoop(opts: UseTalkLoopOptions = {}) {
  const voice = useVoice()
  const mic = useMic()
  const [busy, setBusy] = useState<TalkBusy>('idle')
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const utter = useRef<Utterance | null>(null)
  const runningRef = useRef(false)
  const speakingRef = useRef(false)
  const onTurnRef = useRef<(text: string) => Promise<void>>(async () => undefined)
  const settingsRef = useRef(voice)
  settingsRef.current = voice
  const pausedNotice = opts.pausedNotice ?? DEFAULT_PAUSED_NOTICE

  const stopSpeaking = useCallback(() => {
    utter.current?.stop()
    utter.current = null
    speakingRef.current = false
    setBusy((b) => (b === 'speaking' ? 'idle' : b))
  }, [])

  useEffect(
    () => () => {
      runningRef.current = false
      utter.current?.stop()
    },
    []
  )

  /** Speak a reply when spoken replies are on; resolves when the speech ends. */
  const speak = useCallback((text: string, rate = 1): Promise<void> => {
    const v = settingsRef.current
    if (!v.enabled || !v.settings.spokenReplies) return Promise.resolve()
    utter.current?.stop()
    const u = speakSentences(splitSentences(speakableText(text)), v.settings, v.status, (why) =>
      setNotice(`The speech provider didn’t answer (${why}); using this computer’s voice.`),
      rate
    )
    utter.current = u
    speakingRef.current = true
    setBusy('speaking')
    return u.done.then(() => {
      if (utter.current === u) {
        utter.current = null
        speakingRef.current = false
        setBusy((b) => (b === 'speaking' ? 'idle' : b))
      }
    })
  }, [])

  const setOnTurn = useCallback((fn: (text: string) => Promise<void>) => {
    onTurnRef.current = fn
  }, [])

  const loop = useCallback(async () => {
    while (runningRef.current) {
      const r = await mic.listen({
        handsFree: true,
        onSpeechStart: () => {
          if (speakingRef.current) stopSpeaking()
        },
        // Vault's own voice shouldn't count as the learner talking; echo
        // cancellation helps, and a higher bar while it speaks does the rest.
        detector: { threshold: () => (speakingRef.current ? 0.08 : 0.02), maxWaitMs: 30000 },
      })
      if (!runningRef.current || 'cancelled' in r) break
      if ('timeout' in r) {
        setNotice(pausedNotice)
        break
      }
      if ('error' in r) break
      await onTurnRef.current(r.text)
    }
    runningRef.current = false
    setRunning(false)
  }, [mic, stopSpeaking, pausedNotice])

  const start = useCallback(() => {
    setNotice(null)
    runningRef.current = true
    setRunning(true)
    void loop()
  }, [loop])

  const stop = useCallback(() => {
    runningRef.current = false
    setRunning(false)
    mic.cancel()
    stopSpeaking()
  }, [mic, stopSpeaking])

  const canHear = voice.enabled && voice.status?.canTranscribe === true
  const status = talkStatusText(mic.phase, busy, running)

  return {
    voice,
    mic,
    busy,
    setBusy,
    running,
    runningRef,
    speakingRef,
    notice,
    setNotice,
    stopSpeaking,
    speak,
    setOnTurn,
    start,
    stop,
    canHear,
    status,
  }
}

