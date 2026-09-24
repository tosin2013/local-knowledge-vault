import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  FormControlLabel,
  IconButton,
  Link,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import CloseIcon from '@mui/icons-material/Close'
import MovieIcon from '@mui/icons-material/Movie'
import FullscreenIcon from '@mui/icons-material/Fullscreen'
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit'
import type { VaultPluginRenderProps } from '../types'
import type {
  ChatMessage,
  Citation,
  MediaIngestResult,
  MediaProjectInfo,
} from '../../../electron/types'

function parseCitations(json: string | null): Citation[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as Citation[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function formatClock(sec: number): string {
  const t = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${mm}:${ss}`
  return `${mm}:${ss}`
}

function parseTStart(body: string): number | null {
  const m = body.match(/^\s*t_start:\s*([0-9.]+)\s*$/m)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

function isAudioPath(p?: string): boolean {
  if (!p) return false
  return /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(p)
}

function youtubeIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.replace(/^\//, '').split('/')[0] || null
    }
    const v = u.searchParams.get('v')
    if (v) return v
    const parts = u.pathname.split('/').filter(Boolean)
    const i = parts.indexOf('embed')
    if (i >= 0 && parts[i + 1]) return parts[i + 1]
    const s = parts.indexOf('shorts')
    if (s >= 0 && parts[s + 1]) return parts[s + 1]
  } catch {
    /* ignore */
  }
  return null
}

type ActiveMedia = {
  project: string
  title: string
  sourceType: 'local' | 'youtube'
  mediaPath?: string
  mediaUrl?: string
  mediaProtocolUrl?: string
  promptId: string
  profileId: string
}

/** Media reader + Media voice packs (built-in + custom) as voice chips. */
type MediaVoiceOption = {
  name: string
  promptId: string
}

const MEDIA_VOICE_STORAGE_KEY = 'lkv.mediaVoice'

function readStoredVoiceName(): string | null {
  try {
    const v = localStorage.getItem(MEDIA_VOICE_STORAGE_KEY)
    return v && v.trim() ? v.trim() : null
  } catch {
    return null
  }
}

function writeStoredVoiceName(name: string) {
  try {
    localStorage.setItem(MEDIA_VOICE_STORAGE_KEY, name)
  } catch {
    /* ignore quota / private mode */
  }
}

export function MediaChatView({ onOpenNote, onClose }: VaultPluginRenderProps) {
  const videoRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)
  const currentTimeRef = useRef(0)
  const [projects, setProjects] = useState<MediaProjectInfo[]>([])
  const [active, setActive] = useState<ActiveMedia | null>(null)
  const [ytUrl, setYtUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [followPlayhead, setFollowPlayhead] = useState(true)
  const [chatInput, setChatInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [embedUrl, setEmbedUrl] = useState<string | null>(null)
  const [nearCount, setNearCount] = useState<number | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [voices, setVoices] = useState<MediaVoiceOption[]>([])
  const [activeVoice, setActiveVoice] = useState<string>('Media reader')

  const refreshProjects = useCallback(async () => {
    if (!window.lkv?.media?.listProjects) return
    const list = await window.lkv.media.listProjects()
    setProjects(list)
  }, [])

  useEffect(() => {
    void refreshProjects()
  }, [refreshProjects])

  const refreshVoices = useCallback(async (): Promise<MediaVoiceOption[]> => {
    if (!window.lkv?.prompts?.list) {
      setVoices([])
      return []
    }
    // Best-effort seed so chips appear without opening the personas plugin first
    try {
      await window.lkv.media?.ensurePersonas?.()
    } catch {
      /* optional */
    }
    const opts: MediaVoiceOption[] = []
    const prompts = await window.lkv.prompts.list()
    const reader = prompts.find((x) => x.name === 'Media reader')
    if (reader) opts.push({ name: reader.name, promptId: reader.id })

    if (window.lkv.media?.listVoicePacks) {
      try {
        const packs = await window.lkv.media.listVoicePacks()
        for (const pack of packs) {
          if (opts.some((o) => o.promptId === pack.promptId)) continue
          opts.push({ name: pack.name, promptId: pack.promptId })
        }
      } catch {
        /* fall back to built-in names via prompts */
        for (const name of ['Desk cohost', 'Curious student', 'Skeptical investor']) {
          const p = prompts.find((x) => x.name === name)
          if (p && !opts.some((o) => o.promptId === p.id)) {
            opts.push({ name: p.name, promptId: p.id })
          }
        }
      }
    } else {
      for (const name of ['Desk cohost', 'Curious student', 'Skeptical investor']) {
        const p = prompts.find((x) => x.name === name)
        if (p) opts.push({ name: p.name, promptId: p.id })
      }
    }
    setVoices(opts)
    return opts
  }, [])

  useEffect(() => {
    void refreshVoices()
  }, [refreshVoices])

  useEffect(() => {
    currentTimeRef.current = currentTime
  }, [currentTime])

  // Poll playhead for HTML5 media; rebind after fullscreen remount and restore time
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const onTime = () => setCurrentTime(el.currentTime || 0)
    el.addEventListener('timeupdate', onTime)
    const t = currentTimeRef.current
    if (t > 0) {
      try {
        el.currentTime = t
      } catch {
        /* ignore */
      }
    }
    return () => el.removeEventListener('timeupdate', onTime)
  }, [active?.mediaProtocolUrl, active?.mediaPath, fullscreen])

  // Near-playhead note count (informational)
  useEffect(() => {
    if (!active || !window.lkv?.media?.notesNear) {
      setNearCount(null)
      return
    }
    let cancelled = false
    const tick = async () => {
      try {
        const notes = await window.lkv.media.notesNear({
          project: active.project,
          centerSec: currentTime,
          windowSec: 45,
        })
        if (!cancelled) setNearCount(notes.length)
      } catch {
        if (!cancelled) setNearCount(null)
      }
    }
    void tick()
    return () => {
      cancelled = true
    }
  }, [active, currentTime])

  useEffect(() => {
    if (!active?.mediaUrl) {
      setEmbedUrl(null)
      return
    }
    const id = youtubeIdFromUrl(active.mediaUrl)
    if (id) {
      setEmbedUrl(`https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1`)
    } else {
      setEmbedUrl(null)
    }
  }, [active?.mediaUrl])

  const resolveVoicePrompt = (
    opts: MediaVoiceOption[],
    preferredName?: string | null
  ): { name: string; promptId: string } => {
    const want = preferredName || readStoredVoiceName() || 'Media reader'
    const fromOpts = opts.find((v) => v.name === want)
    if (fromOpts) return fromOpts
    const reader = opts.find((v) => v.name === 'Media reader')
    if (reader) return reader
    return { name: 'Media reader', promptId: '' }
  }

  const applyIngestResult = async (res: MediaIngestResult) => {
    const opts = await refreshVoices()
    const voice = resolveVoicePrompt(opts, readStoredVoiceName())
    setActive({
      project: res.project,
      title: res.title,
      sourceType: res.sourceType,
      mediaPath: res.mediaPath,
      mediaUrl: res.mediaUrl,
      mediaProtocolUrl: res.mediaProtocolUrl,
      promptId: voice.promptId || res.promptId,
      profileId: res.profileId,
    })
    setActiveVoice(voice.name)
    setMessages([])
    setSessionId(null)
    setCurrentTime(0)
    setStatus(
      `Ingested ${res.noteCount} transcript notes · project “${res.project}” · voice “${voice.name}”`
    )
    await refreshProjects()
  }

  const onPickLocal = async () => {
    if (!window.lkv?.media) return
    setError(null)
    setBusy(true)
    try {
      const pick = await window.lkv.media.pickLocal()
      if (pick.canceled || !pick.mediaPath || !pick.captionsPath) {
        if (pick.mediaPath && !pick.captionsPath) {
          setError('Captions (.srt / .vtt) are required for Media chat.')
        }
        return
      }
      const res = await window.lkv.media.ingestLocal({
        mediaPath: pick.mediaPath,
        captionsPath: pick.captionsPath,
      })
      await applyIngestResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onIngestYoutube = async () => {
    if (!window.lkv?.media) return
    const url = ytUrl.trim()
    if (!url) {
      setError('Paste a YouTube URL first')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const res = await window.lkv.media.ingestYoutube({ url })
      await applyIngestResult(res)
      setYtUrl('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const loadProject = async (p: MediaProjectInfo) => {
    if (!window.lkv) return
    setError(null)
    const opts = await refreshVoices()
    const voice = resolveVoicePrompt(opts, readStoredVoiceName())
    const profiles = await window.lkv.profiles.list()
    // Keep any existing project profile for Ask Customize; voice is prompt-only
    const profile = profiles.find((pr) => (pr.project ?? '') === p.project)

    setActive({
      project: p.project,
      title: p.project,
      sourceType: p.sourceType === 'unknown' ? 'local' : p.sourceType,
      mediaPath: p.mediaPath,
      mediaUrl: p.mediaUrl,
      mediaProtocolUrl: p.mediaProtocolUrl,
      promptId: voice.promptId || profile?.prompt_id || '',
      profileId: profile?.id || '',
    })
    setActiveVoice(voice.name)
    setMessages([])
    setSessionId(null)
    setCurrentTime(0)
    setStatus(`Loaded media project “${p.project}” (${p.noteCount} notes) · voice “${voice.name}”`)
  }

  const selectVoice = async (name: string) => {
    if (!window.lkv || !active) return
    const opt = voices.find((v) => v.name === name)
    if (!opt) {
      setError(`Voice “${name}” is not installed yet — open Media personas to install.`)
      return
    }
    // Voice packs are reusable across projects — only switch promptId (no per-video profiles)
    setActiveVoice(name)
    writeStoredVoiceName(name)
    setActive((prev) => (prev ? { ...prev, promptId: opt.promptId } : prev))
    // New voice → fresh session so history isn't mixed across styles
    setMessages([])
    setSessionId(null)
    setStatus(`Voice: ${name} (works with any media project)`)
  }

  const seekTo = (sec: number) => {
    const el = videoRef.current
    if (el) {
      el.currentTime = sec
      void el.play?.()
      setCurrentTime(sec)
      return
    }
    // YouTube iframe: cannot seek without IFrame API wiring — show hint
    setStatus(`Seek target ${formatClock(sec)} — open the watch URL or use local media for click-to-seek.`)
  }

  const onCitationClick = async (id: string) => {
    if (!window.lkv) return
    const item = await window.lkv.items.get(id)
    if (item) {
      const t = parseTStart(item.body)
      if (t != null) seekTo(t)
      onOpenNote?.(id)
    } else {
      onOpenNote?.(id)
    }
  }

  const buildQuestion = (raw: string, forceMoment: boolean): string => {
    const q = raw.trim()
    if (!forceMoment && !followPlayhead) return q
    const clock = formatClock(currentTime)
    const windowHint =
      nearCount != null
        ? ` (~${nearCount} transcript notes near ±45s)`
        : ''
    return `[At ${clock} in the media${windowHint}] ${q}`
  }

  const onSend = async (opts?: { aboutMoment?: boolean }) => {
    if (!window.lkv || !active || !chatInput.trim()) return
    const text = buildQuestion(chatInput, !!opts?.aboutMoment)
    setChatInput('')
    setBusy(true)
    setError(null)
    try {
      let sid = sessionId
      if (!sid) {
        const session = await window.lkv.chat.createSession({
          mode: 'grounded',
          title: `Media · ${active.title}`.slice(0, 48),
          filters: { project: active.project },
        })
        sid = session.id
        setSessionId(sid)
      }
      const res = await window.lkv.chat.send({
        sessionId: sid,
        text,
        filters: { project: active.project },
        promptId: active.promptId || undefined,
        limit: 8,
      })
      setMessages(res.messages)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const mediaSrc = active?.mediaProtocolUrl
  const useAudio = isAudioPath(active?.mediaPath)

  const emptyHint = useMemo(
    () =>
      active
        ? 'Ask about this media — answers cite transcript notes (itm_). Click a citation to seek.'
        : 'Ingest a local file + captions, or a YouTube URL, then chat grounded in the transcript.',
    [active]
  )

  const exitFullscreen = useCallback(() => setFullscreen(false), [])

  const renderPlayerControls = () => (
    <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
      <Chip size="small" label={`Now: ${formatClock(currentTime)}`} />
      {nearCount != null && (
        <Chip size="small" variant="outlined" label={`${nearCount} notes near playhead`} />
      )}
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={followPlayhead}
            onChange={(e) => setFollowPlayhead(e.target.checked)}
          />
        }
        label={<Typography variant="caption">Follow playhead</Typography>}
      />
      <Button
        size="small"
        variant="outlined"
        disabled={!active || busy || !chatInput.trim()}
        onClick={() => void onSend({ aboutMoment: true })}
      >
        Ask about this moment
      </Button>
    </Stack>
  )

  const renderPlayer = (opts?: { grow?: boolean }) => {
    const grow = !!opts?.grow
    return (
      <Paper
        variant="outlined"
        sx={{
          p: 1.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          minHeight: grow ? 0 : 280,
          flex: grow ? 1 : undefined,
          minWidth: 0,
        }}
      >
        <Typography variant="subtitle2" noWrap>
          {active ? active.title : 'No media loaded'}
        </Typography>
        {active?.sourceType === 'local' && mediaSrc ? (
          useAudio ? (
            <audio
              ref={videoRef as React.RefObject<HTMLAudioElement>}
              controls
              src={mediaSrc}
              style={{ width: '100%' }}
            />
          ) : (
            <video
              ref={videoRef as React.RefObject<HTMLVideoElement>}
              controls
              src={mediaSrc}
              style={{
                width: '100%',
                flex: grow ? 1 : undefined,
                maxHeight: grow ? 'none' : 360,
                minHeight: grow ? 240 : undefined,
                background: '#000',
                borderRadius: 8,
                objectFit: 'contain',
              }}
            />
          )
        ) : active?.sourceType === 'youtube' && embedUrl ? (
          <Box
            sx={{
              position: 'relative',
              pt: grow ? 0 : '56.25%',
              flex: grow ? 1 : undefined,
              minHeight: grow ? 240 : undefined,
              bgcolor: '#000',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <iframe
              title="YouTube"
              src={embedUrl}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={
                grow
                  ? { width: '100%', height: '100%', border: 0, minHeight: 240 }
                  : { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }
              }
            />
          </Box>
        ) : (
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'action.hover',
              borderRadius: 2,
              minHeight: grow ? 200 : 160,
              px: 2,
            }}
          >
            <Typography variant="body2" color="text.secondary" align="center">
              Pick a local file with an .srt/.vtt companion, or ingest YouTube captions.
            </Typography>
          </Box>
        )}

        {active?.mediaUrl && (
          <Typography variant="caption" color="text.secondary">
            Watch:{' '}
            <Link href={active.mediaUrl} target="_blank" rel="noreferrer">
              {active.mediaUrl}
            </Link>
          </Typography>
        )}

        {renderPlayerControls()}
        {active?.sourceType === 'youtube' && (
          <Typography variant="caption" color="text.secondary">
            YouTube embed may restrict seeking from citations. Use “Ask about this moment” with a manual
            time, or prefer local media for full seek sync.
          </Typography>
        )}
      </Paper>
    )
  }

  const renderAsk = (opts?: { fillHeight?: boolean }) => {
    const fillHeight = !!opts?.fillHeight
    return (
      <Paper
        variant="outlined"
        sx={{
          p: 1.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          minHeight: fillHeight ? 0 : 280,
          flex: fillHeight ? 1 : undefined,
          minWidth: 0,
          height: fillHeight ? '100%' : undefined,
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Ask (grounded)
          </Typography>
          {active && <Chip size="small" label={active.project} color="primary" variant="outlined" />}
        </Stack>
        {active && voices.length > 0 && (
          <Stack direction="row" flexWrap="wrap" gap={0.5} alignItems="center">
            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
              Voice:
            </Typography>
            {voices.map((v) => (
              <Chip
                key={v.promptId}
                size="small"
                label={v.name}
                color={activeVoice === v.name ? 'primary' : 'default'}
                variant={activeVoice === v.name ? 'filled' : 'outlined'}
                onClick={() => void selectVoice(v.name)}
                disabled={busy}
                sx={{ cursor: 'pointer' }}
              />
            ))}
          </Stack>
        )}

        <Box sx={{ flex: 1, overflow: 'auto', minHeight: fillHeight ? 160 : 120 }}>
          {messages.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              {emptyHint}
            </Typography>
          ) : (
            <Stack spacing={1.25}>
              {messages.map((m) => {
                const cites = m.role === 'assistant' ? parseCitations(m.citations_json) : []
                return (
                  <Box
                    key={m.id}
                    sx={{
                      alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '95%',
                      bgcolor: m.role === 'user' ? 'primary.main' : 'action.hover',
                      color: m.role === 'user' ? 'primary.contrastText' : 'text.primary',
                      px: 1.25,
                      py: 1,
                      borderRadius: 2,
                    }}
                  >
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                      {m.content}
                    </Typography>
                    {cites.length > 0 && (
                      <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.75 }}>
                        {cites.map((c) => (
                          <Chip
                            key={c.id}
                            size="small"
                            label={c.title || c.id}
                            onClick={() => void onCitationClick(c.id)}
                            sx={{ cursor: 'pointer' }}
                          />
                        ))}
                      </Stack>
                    )}
                  </Box>
                )
              })}
            </Stack>
          )}
        </Box>

        <Stack direction="row" spacing={1} alignItems="flex-end">
          <TextField
            size="small"
            fullWidth
            multiline
            maxRows={4}
            placeholder={active ? 'Ask about this media…' : 'Ingest media first…'}
            value={chatInput}
            disabled={!active || busy}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void onSend()
              }
            }}
          />
          <IconButton
            color="primary"
            disabled={!active || busy || !chatInput.trim()}
            onClick={() => void onSend()}
            aria-label="Send"
          >
            <SendIcon />
          </IconButton>
        </Stack>
      </Paper>
    )
  }

  const renderPlayerAskLayout = (opts?: { large?: boolean }) => {
    const large = !!opts?.large
    return (
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: large ? '1.2fr 1fr' : '1.1fr 1fr' },
          gridTemplateRows: { xs: 'auto 1fr', md: '1fr' },
          gap: 1.5,
        }}
      >
        {renderPlayer({ grow: large })}
        {renderAsk({ fillHeight: large })}
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, p: 1.5, gap: 1.5 }}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
        <MovieIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
          Media chat
        </Typography>
        <IconButton
          size="small"
          onClick={() => setFullscreen(true)}
          aria-label="Enter fullscreen"
          title="Fullscreen"
        >
          <FullscreenIcon fontSize="small" />
        </IconButton>
        {onClose && (
          <IconButton size="small" onClick={onClose} aria-label="Close Media chat" title="Back to Ask">
            <CloseIcon fontSize="small" />
          </IconButton>
        )}
      </Stack>

      {status && (
        <Alert severity="success" onClose={() => setStatus(null)}>
          {status}
        </Alert>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!fullscreen && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack spacing={1.25}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
            >
              Ingest
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
              <Button variant="contained" size="small" disabled={busy} onClick={() => void onPickLocal()}>
                Local video/audio + captions
              </Button>
              <TextField
                size="small"
                fullWidth
                placeholder="https://youtube.com/watch?v=…"
                value={ytUrl}
                disabled={busy}
                onChange={(e) => setYtUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void onIngestYoutube()
                  }
                }}
                aria-label="YouTube URL"
              />
              <Button variant="outlined" size="small" disabled={busy} onClick={() => void onIngestYoutube()}>
                Ingest YouTube
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Captions become searchable transcript notes in your vault.
            </Typography>
            {projects.length > 0 && (
              <TextField
                select
                size="small"
                label="Open media project"
                value={active?.project ?? ''}
                onChange={(e) => {
                  const p = projects.find((x) => x.project === e.target.value)
                  if (p) void loadProject(p)
                }}
                sx={{ maxWidth: 420 }}
              >
                <MenuItem value="">
                  <em>Select…</em>
                </MenuItem>
                {projects.map((p) => (
                  <MenuItem key={p.project} value={p.project}>
                    {p.project} ({p.noteCount}) · {p.sourceType}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Stack>
        </Paper>
      )}

      {/* Only mount player+Ask once (normal or fullscreen) to avoid duplicate media elements */}
      {!fullscreen && renderPlayerAskLayout()}

      <Dialog
        fullScreen
        open={fullscreen}
        onClose={exitFullscreen}
        aria-labelledby="media-chat-fullscreen-title"
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, p: 1.5, gap: 1.5 }}>
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
            <MovieIcon color="primary" fontSize="small" />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography id="media-chat-fullscreen-title" variant="subtitle1" fontWeight={600} noWrap>
                {active ? active.title : 'Media chat'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Transcript notes stay in your vault · Esc to exit fullscreen
              </Typography>
            </Box>
            <IconButton
              size="small"
              onClick={exitFullscreen}
              aria-label="Exit fullscreen"
              title="Exit fullscreen"
            >
              <FullscreenExitIcon fontSize="small" />
            </IconButton>
            <Button size="small" variant="outlined" onClick={exitFullscreen}>
              Exit fullscreen
            </Button>
          </Stack>

          {status && (
            <Alert severity="success" onClose={() => setStatus(null)}>
              {status}
            </Alert>
          )}
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {fullscreen && renderPlayerAskLayout({ large: true })}
        </Box>
      </Dialog>
    </Box>
  )
}
