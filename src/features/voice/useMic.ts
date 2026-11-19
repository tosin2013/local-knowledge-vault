import { useCallback, useEffect, useRef, useState } from 'react'
import { micErrorMessage, startMic, type MicCapture } from './audio'
import { createTurnDetector, type TurnDetectorOptions } from './speech'

export type MicPhase = 'idle' | 'listening' | 'transcribing'

export interface ListenOptions {
  /** End the turn on silence (hands-free). Without it, the turn ends on `stop()` (push-to-talk). */
  handsFree?: boolean
  /** Called once when the learner starts talking (used to interrupt Vault's voice). */
  onSpeechStart?: () => void
  detector?: TurnDetectorOptions
}

export type ListenResult = { text: string } | { error: string } | { timeout: true } | { cancelled: true }

/**
 * The microphone for voice study (#413): one turn at a time, transcribed by the
 * speech provider. Push-to-talk ends on `stop()`; hands-free ends after a pause.
 */
export function useMic() {
  const [phase, setPhase] = useState<MicPhase>('idle')
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const capture = useRef<MicCapture | null>(null)
  const finishTurn = useRef<(() => void) | null>(null)
  const cancelTurn = useRef<(() => void) | null>(null)

  useEffect(
    () => () => {
      capture.current?.cancel()
    },
    []
  )

  const listen = useCallback(async (opts: ListenOptions = {}): Promise<ListenResult> => {
    setError(null)
    const api = window.lkv?.voice
    if (!api?.transcribe) {
      const msg = 'Voice isn’t available in this build. Restart Vault after updating.'
      setError(msg)
      return { error: msg }
    }
    let snap = false
    try {
      const access = await api.micAccess()
      snap = access.snap
      if (!access.granted) {
        const msg = micErrorMessage({ name: 'NotAllowedError' }, snap)
        setError(msg)
        return { error: msg }
      }
    } catch {
      /* older preload: let getUserMedia ask */
    }
    let ended: 'done' | 'timeout' | 'cancel' | null = null
    let resolveEnd: () => void = () => undefined
    const endPromise = new Promise<void>((r) => {
      resolveEnd = r
    })
    const end = (why: 'done' | 'timeout' | 'cancel') => {
      if (ended) return
      ended = why
      resolveEnd()
    }
    finishTurn.current = () => end('done')
    cancelTurn.current = () => end('cancel')
    const detector = createTurnDetector(opts.detector)
    let spoke = false
    try {
      capture.current = await startMic((lvl, now) => {
        setLevel(lvl)
        const st = detector.step(lvl, now)
        if (st !== 'waiting' && !spoke) {
          spoke = true
          opts.onSpeechStart?.()
        }
        if (opts.handsFree && (st === 'done' || st === 'timeout')) end(st)
      })
    } catch (e) {
      const msg = micErrorMessage(e, snap)
      setError(msg)
      return { error: msg }
    }
    setPhase('listening')
    await endPromise
    const cap = capture.current
    capture.current = null
    finishTurn.current = null
    cancelTurn.current = null
    setLevel(0)
    if (ended === 'cancel' || ended === 'timeout') {
      cap?.cancel()
      setPhase('idle')
      return ended === 'cancel' ? { cancelled: true } : { timeout: true }
    }
    setPhase('transcribing')
    try {
      const wav = await cap!.stop()
      if (!wav) {
        setPhase('idle')
        return { text: '' }
      }
      const res = await api.transcribe(wav)
      setPhase('idle')
      if (!res.ok) {
        setError(res.error)
        return { error: res.error }
      }
      return { text: res.text }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setPhase('idle')
      return { error: msg }
    }
  }, [])

  /** End the current turn and transcribe it (push-to-talk release). */
  const stop = useCallback(() => finishTurn.current?.(), [])
  /** Drop the current turn. */
  const cancel = useCallback(() => cancelTurn.current?.(), [])

  return { phase, level, error, setError, listen, stop, cancel }
}
