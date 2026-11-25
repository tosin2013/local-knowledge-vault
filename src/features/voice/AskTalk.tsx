import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, LinearProgress, Stack, Typography } from '@mui/material'
import MicIcon from '@mui/icons-material/Mic'
import StopIcon from '@mui/icons-material/Stop'
import { parseSpokenCommand } from './speech'
import { updateVoiceSettings, refreshVoiceStatus } from './useVoice'
import { useTalkLoop } from './useTalkLoop'

export type SpokenTurnResult =
  | { ok: true; content: string; citationsJson: string | null; offline: boolean }
  | { ok: false; error: string }

export interface UseAskTalkOptions {
  onSpokenTurn: (text: string) => Promise<SpokenTurnResult | void>
  onOpenVoiceSettings: () => void
  activeSessionId: string | null
}

const PAUSED_NOTICE = 'Paused: I didn’t hear anything for a while. Press Talk to carry on.'
const STOPPED_NOTICE = 'Okay. Press Talk whenever you want to pick this up again.'
const OFFLINE_NOTICE =
  'No AI model answered, so this reply is search results only. Check Settings → AI providers.'
const VOICE_OFF_COPY =
  'To talk out loud about this chat, turn on Voice study. You can also review voices and models in Settings → AI providers → Voice.'

/**
 * Hands-free Talk in Ask (#426): starts a continuous conversation in the
 * current chat thread and keeps going until End conversation or a spoken "stop".
 */
export function useAskTalk({ onSpokenTurn, onOpenVoiceSettings, activeSessionId }: UseAskTalkOptions) {
  const talk = useTalkLoop({ pausedNotice: PAUSED_NOTICE })
  const [setupOpen, setSetupOpen] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const startedSession = useRef<string | null | undefined>(undefined)
  const { stop, start, stopSpeaking, setBusy, setNotice, speak, runningRef, setOnTurn, canHear, running, voice } = talk

  const endConversation = useCallback(() => {
    startedSession.current = undefined
    stop()
  }, [stop])

  const respond = useCallback(
    async (text: string) => {
      const t = text.trim()
      if (!t) return
      stopSpeaking()
      if (parseSpokenCommand(t) === 'stop') {
        startedSession.current = undefined
        runningRef.current = false
        stop()
        setNotice(STOPPED_NOTICE)
        await speak(STOPPED_NOTICE)
        return
      }
      setBusy('thinking')
      try {
        const res = await onSpokenTurn(t)
        setBusy('idle')
        if (!res) return
        if (!res.ok) {
          setNotice(res.error)
          return
        }
        if (res.offline) setNotice(OFFLINE_NOTICE)
        // Don't await: the loop starts listening again so the user can interrupt.
        void speak(res.content)
      } catch (e) {
        setBusy('idle')
        setNotice(e instanceof Error ? e.message : String(e))
      }
    },
    [onSpokenTurn, stopSpeaking, runningRef, stop, setNotice, speak, setBusy]
  )

  setOnTurn(respond)

  const begin = useCallback(() => {
    startedSession.current = activeSessionId
    setSetupOpen(false)
    start()
  }, [activeSessionId, start])

  useEffect(() => {
    if (!running) {
      startedSession.current = undefined
      return
    }
    if (startedSession.current === undefined) startedSession.current = activeSessionId
    else if (startedSession.current === null && activeSessionId) startedSession.current = activeSessionId
    else if (activeSessionId !== startedSession.current) endConversation()
  }, [running, activeSessionId, endConversation])

  const startOrSetup = useCallback(async () => {
    if (running) {
      endConversation()
      return
    }
    if (canHear) {
      begin()
      return
    }
    setSetupOpen(true)
    onOpenVoiceSettings()
    if (voice.enabled) await voice.refresh()
  }, [running, canHear, begin, endConversation, onOpenVoiceSettings, voice])

  const enableAndStart = useCallback(async () => {
    setEnabling(true)
    try {
      await updateVoiceSettings({ enabled: true })
      const status = await refreshVoiceStatus()
      if (status?.canTranscribe) {
        setSetupOpen(false)
        begin()
      }
    } finally {
      setEnabling(false)
    }
  }, [begin])

  return {
    talk,
    respond,
    setupOpen,
    setSetupOpen,
    enabling,
    startOrSetup,
    enableAndStart,
    endConversation,
  }
}

/** The always-visible Talk button, live state, and the unready explanation. */
export function AskTalkControls({
  askTalk,
  sending,
}: {
  askTalk: ReturnType<typeof useAskTalk>
  sending?: boolean
}) {
  const { talk, setupOpen, setSetupOpen, enabling, startOrSetup, enableAndStart } = askTalk
  const voiceOff = !talk.voice.enabled
  const unreadyHint =
    talk.voice.enabled && !talk.canHear ? (talk.voice.status?.sttHint ?? 'Speech-to-text isn’t ready yet.') : null

  return (
    <Box data-testid="ask-talk" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0.75, minWidth: 0 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          data-testid="ask-talk-button"
          variant="contained"
          color={talk.running ? 'error' : 'primary'}
          startIcon={talk.running ? <StopIcon /> : <MicIcon />}
          onClick={() => void startOrSetup()}
          disabled={!talk.running && !!sending}
          aria-pressed={talk.running}
          sx={{
            whiteSpace: 'nowrap',
            fontWeight: 600,
            height: 48,
            px: 2,
            borderRadius: 4,
            flexShrink: 0,
          }}
        >
          {talk.running ? 'End conversation' : 'Talk it through'}
        </Button>
        <Typography variant="body2" role="status" data-testid="ask-talk-status" sx={{ color: 'text.secondary', minHeight: '1.25em' }}>
          {talk.status}
        </Typography>
      </Stack>
      {talk.running && talk.mic.phase === 'listening' && (
        <LinearProgress
          variant="determinate"
          value={Math.min(100, talk.mic.level * 800)}
          aria-label="Microphone level"
          sx={{ height: 4, borderRadius: 2 }}
        />
      )}
      {setupOpen && voiceOff && (
        <Alert severity="info" data-testid="ask-talk-setup" onClose={() => setSetupOpen(false)}>
          {VOICE_OFF_COPY}{' '}
          <Button color="inherit" size="small" disabled={enabling} onClick={() => void enableAndStart()} sx={{ ml: 0.5 }}>
            {enabling ? 'Turning on…' : 'Turn on Voice'}
          </Button>
        </Alert>
      )}
      {setupOpen && unreadyHint && (
        <Alert severity="info" data-testid="ask-talk-unready" onClose={() => setSetupOpen(false)}>
          {unreadyHint} Open Settings → AI providers → Voice to finish setup.
        </Alert>
      )}
      {(talk.notice || talk.mic.error) && (
        <Alert
          severity="warning"
          data-testid="ask-talk-notice"
          onClose={() => {
            talk.setNotice(null)
            talk.mic.setError(null)
          }}
        >
          {talk.notice ?? talk.mic.error}
        </Alert>
      )}
    </Box>
  )
}
