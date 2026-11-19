import { useRef } from 'react'
import { Alert, Box, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material'
import MicIcon from '@mui/icons-material/Mic'
import { useMic } from './useMic'
import { useVoice } from './useVoice'

export interface MicButtonProps {
  /** Called with the transcript of each spoken turn. */
  onTranscript: (text: string) => void
  disabled?: boolean
  /** Accessible name, e.g. "Hold to answer out loud". */
  label?: string
}

/**
 * Push-to-talk (#413): hold the button (or Space / Enter on it) while you talk,
 * let go to transcribe. Typing stays available; when speech-to-text isn't set
 * up, the button explains how to get it instead.
 */
export function MicButton({ onTranscript, disabled, label = 'Hold to talk' }: MicButtonProps) {
  const voice = useVoice()
  const mic = useMic()
  const holding = useRef(false)

  if (!voice.enabled) return null
  const ready = voice.status?.canTranscribe === true

  const begin = () => {
    if (holding.current || disabled || !ready) return
    holding.current = true
    void mic.listen().then((r) => {
      if ('text' in r && r.text.trim()) onTranscript(r.text.trim())
    })
  }
  const end = () => {
    if (!holding.current) return
    holding.current = false
    mic.stop()
  }

  return (
    <Box data-testid="mic-button" sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5 }}>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        <Tooltip title={ready ? label : (voice.status?.sttHint ?? 'Checking speech-to-text…')}>
          <span>
            <IconButton
              aria-label={label}
              color={mic.phase === 'listening' ? 'error' : 'primary'}
              disabled={disabled || !ready || mic.phase === 'transcribing'}
              onPointerDown={begin}
              onPointerUp={end}
              onPointerLeave={end}
              onKeyDown={(e) => {
                if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                  e.preventDefault()
                  begin()
                }
              }}
              onKeyUp={(e) => {
                if (e.key === ' ' || e.key === 'Enter') end()
              }}
            >
              {mic.phase === 'transcribing' ? <CircularProgress size={20} /> : <MicIcon />}
            </IconButton>
          </span>
        </Tooltip>
        <Typography variant="caption" role="status" sx={{ color: 'text.secondary' }}>
          {mic.phase === 'listening' ? 'Listening… let go when you’re done' : mic.phase === 'transcribing' ? 'Writing down what you said…' : ''}
        </Typography>
      </Box>
      {!ready && voice.status?.sttHint && (
        <Typography variant="caption" data-testid="mic-hint" sx={{ color: 'text.secondary' }}>
          {voice.status.sttHint}
        </Typography>
      )}
      {mic.error && (
        <Alert severity="warning" onClose={() => mic.setError(null)} sx={{ py: 0 }}>
          {mic.error}
        </Alert>
      )}
    </Box>
  )
}
