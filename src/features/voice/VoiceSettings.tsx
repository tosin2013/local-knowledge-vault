import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import type { VoicePullProgress } from '../../../electron/types'
import { speakText, systemVoiceNames } from './audio'
import { useVoice } from './useVoice'

const TEST_LINE = 'Hi! This is the voice Vault will use when you study out loud.'

/** "provider:Zoey" / "system:Samantha" / "provider:" (the model's default voice). */
function voiceKey(output: string, name: string): string {
  return `${output}:${name}`
}

/**
 * Settings → Voice (#413): turn voice study on or off, spoken replies, which
 * provider serves speech, the voice, a test button, and downloads for Ollama's
 * speech models with a progress bar.
 */
export function VoiceSettings({ autoFocus }: { autoFocus?: boolean } = {}) {
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (autoFocus) rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [autoFocus])
  const voice = useVoice()
  const [systemVoices, setSystemVoices] = useState<string[]>(() => systemVoiceNames())
  const [pulls, setPulls] = useState<Record<string, VoicePullProgress>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined
    if (!synth) return
    const onChange = () => setSystemVoices(systemVoiceNames())
    synth.addEventListener?.('voiceschanged', onChange)
    return () => synth.removeEventListener?.('voiceschanged', onChange)
  }, [])

  useEffect(() => {
    if (voice.settings.enabled) void voice.refresh()
  }, [voice.settings.enabled, voice.refresh])

  useEffect(() => {
    const on = window.lkv?.voice?.onPullProgress
    if (!on) return
    return on((p) => setPulls((prev) => ({ ...prev, [p.model]: p })))
  }, [])

  if (!window.lkv?.voice) return null
  const { settings, status } = voice

  const download = async (model: string) => {
    setPulls((prev) => ({ ...prev, [model]: { model, status: 'starting' } }))
    const end = await window.lkv.voice.pull(model)
    setPulls((prev) => ({ ...prev, [model]: end }))
    if (!end.error) await voice.refresh()
  }

  const test = async () => {
    setTesting(true)
    setNotice(null)
    await speakText(TEST_LINE, settings, status, (why) => setNotice(`Ollama’s voice didn’t answer (${why}), so this is your computer’s voice.`)).done
    setTesting(false)
  }

  const providerVoices = status?.canSpeak ? status.voices : []
  const options: { key: string; label: string }[] = [
    ...(status?.canSpeak ? [{ key: voiceKey('provider', ''), label: `${status.providerLabel} · default voice` }] : []),
    ...providerVoices.map((v) => ({ key: voiceKey('provider', v), label: `${status!.providerLabel} · ${v}` })),
    { key: voiceKey('system', ''), label: 'This computer · default voice' },
    ...systemVoices.map((v) => ({ key: voiceKey('system', v), label: `This computer · ${v}` })),
  ]
  let current = voiceKey(status?.canSpeak ? settings.output : 'system', settings.output === 'system' || status?.canSpeak ? settings.voice : '')
  if (!options.some((o) => o.key === current)) {
    // A saved voice the list doesn't offer (yet): keep it visible rather than silently swap it.
    options.push({ key: current, label: `${current.startsWith('provider') ? status?.providerLabel ?? 'Provider' : 'This computer'} · ${settings.voice || 'default voice'}` })
  }

  const pullRow = (model: string) => {
    const p = pulls[model]
    const pct = p?.total ? Math.round(((p.completed ?? 0) / p.total) * 100) : null
    const busy = !!p && !p.done
    return (
      <Box key={model} sx={{ mt: 0.5 }}>
        <Button size="small" variant="outlined" disabled={busy} onClick={() => void download(model)}>
          {busy ? `Downloading ${model}…` : `Download ${model}`}
        </Button>
        {busy && (
          <LinearProgress
            sx={{ mt: 0.5, maxWidth: 360 }}
            variant={pct == null ? 'indeterminate' : 'determinate'}
            value={pct ?? 0}
            aria-label={`Downloading ${model}`}
          />
        )}
        {busy && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {p!.status}
            {pct != null ? ` · ${pct}%` : ''}
          </Typography>
        )}
        {p?.error && (
          <Typography variant="caption" color="error" sx={{ display: 'block' }}>
            {p.error}
          </Typography>
        )}
      </Box>
    )
  }

  return (
    <Box ref={rootRef} id="voice-settings" sx={{ mt: 2 }} data-testid="voice-settings">
      <Divider sx={{ my: 1.5 }} />
      <Typography variant="subtitle2">Voice</Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
        Talk through your notes and answer Study questions out loud. Speech goes to the provider below; with Ollama it stays on
        this computer.
      </Typography>
      <FormControlLabel
        control={<Switch checked={settings.enabled} onChange={(e) => void voice.update({ enabled: e.target.checked })} />}
        label="Voice study"
      />
      {settings.enabled && (
        <Stack spacing={1.25} sx={{ mt: 0.5 }}>
          <FormControlLabel
            control={<Switch checked={settings.spokenReplies} onChange={(e) => void voice.update({ spokenReplies: e.target.checked })} />}
            label="Spoken replies"
          />
          {(status?.providers.length ?? 0) > 1 && (
            <FormControl size="small" sx={{ maxWidth: 360 }}>
              <InputLabel id="voice-provider-label">Speech provider</InputLabel>
              <Select
                labelId="voice-provider-label"
                label="Speech provider"
                value={settings.providerId}
                onChange={(e) => void voice.update({ providerId: String(e.target.value) })}
              >
                {status!.providers.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.label}
                    {p.local ? '' : ' (cloud: your audio leaves this computer)'}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {status && !status.local && (
            <Alert severity="warning">
              {status.providerLabel} is a cloud provider, so your recordings and Vault’s replies are sent to it.
            </Alert>
          )}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <FormControl size="small" sx={{ minWidth: 260 }}>
              <InputLabel id="voice-voice-label">Voice</InputLabel>
              <Select
                labelId="voice-voice-label"
                label="Voice"
                value={current}
                onChange={(e) => {
                  const v = String(e.target.value)
                  const i = v.indexOf(':')
                  void voice.update({ output: v.slice(0, i) as 'provider' | 'system', voice: v.slice(i + 1) })
                }}
              >
                {options.map((o) => (
                  <MenuItem key={o.key} value={o.key}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button size="small" onClick={() => void test()} disabled={testing}>
              {testing ? 'Speaking…' : 'Test voice'}
            </Button>
          </Stack>
          {notice && <Typography variant="caption">{notice}</Typography>}
          {voice.checking && <Typography variant="caption">Checking speech models…</Typography>}
          {status && (
            <Box role="status">
              <Typography variant="body2">
                Speech to text ({status.sttModel}): {status.canTranscribe ? 'ready' : 'not ready'}
              </Typography>
              {status.sttHint && (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                  {status.sttHint}
                </Typography>
              )}
              {status.ollama && status.reachable && !status.canTranscribe && pullRow(status.sttModel)}
              <Typography variant="body2" sx={{ mt: 1 }}>
                Spoken replies ({status.canSpeak ? status.ttsModel : 'this computer’s voices'}): ready
              </Typography>
              {status.ttsHint && (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                  {status.ttsHint}
                </Typography>
              )}
              {status.ollama && status.reachable && !status.canSpeak && pullRow(status.ttsModel)}
              {status.snap && (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
                  Installed as a snap: to use the microphone, run sudo snap connect local-knowledge-vault:audio-record once.
                </Typography>
              )}
            </Box>
          )}
          <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={() => void voice.refresh()} disabled={voice.checking}>
            Re-check speech
          </Button>
        </Stack>
      )}
    </Box>
  )
}
