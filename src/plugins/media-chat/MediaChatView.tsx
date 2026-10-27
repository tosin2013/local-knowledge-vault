import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  LinearProgress,
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
import AddIcon from '@mui/icons-material/Add'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import type { VaultPluginRenderProps } from '../types'
import { AI_DRAFT_STATUS, loadImportProject, provenanceHeader, saveImportProject } from '../../domain'
import { AnswerProviderChip } from '../../components/ai/AnswerProviderChip'
import { AnswerText, CitationChips } from '../../components/answer/AnswerText'
import { MoveNotesAction } from '../../features/MoveNotesAction'
import { ProjectSelect } from '../../features/ProjectSelect'
import type {
  ChatMessage,
  Citation,
  MediaBookmark,
  MediaIngestResult,
  MediaProjectInfo,
  TutorPracticeResult,
  TutorQuiz,
} from '../../../electron/types'
import { BookmarkTimeline, BookmarksPanel } from './BookmarksPanel'
import { TutorPanel, isQuizRequest } from './TutorPanel'
import { GuidePanel } from './GuidePanel'
import {
  bookmarkQuestion,
  describeBookmark,
  formatHms,
  isBookmarkShortcut,
  sortBookmarks,
  summarizeQuestion,
  takePendingOpen,
} from './bookmarks'

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

/**
 * One transcript chunk as a readable passage line (#331): machine metadata
 * (t_start/t_end/source_path/source_url/kind_tag/cited) stripped, prefixed
 * with the chunk's clock time.
 */
function transcriptPassageChunk(body: string, clock: string): string {
  const text = body
    .split('\n')
    .filter((line) => !/^\s*(t_start|t_end|source_path|source_url|kind_tag|cited):/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text ? `[${clock}] ${text}` : ''
}

function isAudioPath(p?: string): boolean {
  if (!p) return false
  return /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(p)
}

/** Minimal YouTube IFrame API surface used by Media chat. */
interface YTPlayer {
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getPlayerState(): number
  /** Video length in seconds (0 until known) — places bookmark ticks (#334). */
  getDuration?(): number
  destroy(): void
  /** The iframe the player is bound to — lets us detect a detached player (#327). */
  getIframe?(): HTMLIFrameElement
  /** Pauses playback — a study-guide checkpoint pauses gently (#365). */
  pauseVideo?(): void
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLIFrameElement,
        opts: {
          events?: { onReady?: () => void; onStateChange?: (e: { data: number }) => void }
        }
      ) => YTPlayer
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

const YT_IFRAME_API = 'https://www.youtube.com/iframe_api'
let ytApiPromise: Promise<void> | null = null

/** Load the YouTube IFrame API once (no-op when already present or unavailable). */
function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.YT?.Player) return Promise.resolve()
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('YouTube IFrame API timed out')), 15000)
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer)
      resolve()
    }
    const script = document.createElement('script')
    script.src = YT_IFRAME_API
    script.async = true
    script.onerror = () => {
      clearTimeout(timer)
      ytApiPromise = null
      reject(new Error('Could not load the YouTube player API'))
    }
    document.head.appendChild(script)
  })
  return ytApiPromise
}

/** Video id from a youtube-nocookie embed URL produced by media:youtubeEmbedUrl. */
function videoIdFromEmbedUrl(embedUrl: string): string | null {
  const m = embedUrl.match(/\/embed\/([\w-]{11})/)
  return m ? m[1] : null
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

/** Playhead retrieval window options (#161), in seconds. */
const PLAYHEAD_WINDOW_OPTIONS = [30, 45, 60, 180]
const PLAYHEAD_WINDOW_STORAGE_KEY = 'lkv.media.playheadWindowSec'

function loadPlayheadWindowSec(): number {
  try {
    const v = Number(localStorage.getItem(PLAYHEAD_WINDOW_STORAGE_KEY))
    return PLAYHEAD_WINDOW_OPTIONS.includes(v) ? v : 45
  } catch {
    return 45
  }
}

function savePlayheadWindowSec(sec: number): void {
  try {
    localStorage.setItem(PLAYHEAD_WINDOW_STORAGE_KEY, String(sec))
  } catch {
    /* ignore quota / private mode */
  }
}

function windowLabel(sec: number): string {
  return sec >= 60 ? `±${sec / 60}m` : `±${sec}s`
}

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

export function MediaChatView({ onOpenNote, onNewDraft, onClose }: VaultPluginRenderProps) {
  const videoRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)
  const ytFrameRef = useRef<HTMLIFrameElement | null>(null)
  const ytPlayerRef = useRef<YTPlayer | null>(null)
  /** Position to seek to once the player is ready — from the saved state (#329). */
  const resumeSecRef = useRef(0)
  const notesNearAtRef = useRef(0)
  const currentTimeRef = useRef(0)
  const [projects, setProjects] = useState<MediaProjectInfo[]>([])
  const [active, setActive] = useState<ActiveMedia | null>(null)
  const [ytUrl, setYtUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [ingestStage, setIngestStage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  // Target project for the next ingest ('' = use the media file name, #276);
  // defaults to the last project any import was filed into.
  const [ingestProject, setIngestProject] = useState<string>(loadImportProject)
  // Post-ingest "Move N notes" offer (#276).
  const [moveOffer, setMoveOffer] = useState<{ itemIds: string[] } | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [followPlayhead, setFollowPlayhead] = useState(true)
  const [chatInput, setChatInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [embedUrl, setEmbedUrl] = useState<string | null>(null)
  const [ytVideoId, setYtVideoId] = useState<string | null>(null)
  const [ytReady, setYtReady] = useState(false)
  const [nearCount, setNearCount] = useState<number | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  /** #332: whether the (collapsed) ingest controls are expanded once a video is loaded. */
  const [ingestOpen, setIngestOpen] = useState(false)
  /** Playhead retrieval window (#161): scopes near-count, moment saves and retrieval. */
  const [playheadWindowSec, setPlayheadWindowSec] = useState<number>(loadPlayheadWindowSec)
  // #328: cited-passage shown inside fullscreen (the app-side note drawer would
  // open behind the overlay, hidden but focus-stealing — Esc would stop working).
  const [fsNote, setFsNote] = useState<{ title: string; body: string } | null>(null)
  const [voices, setVoices] = useState<MediaVoiceOption[]>([])
  const [activeVoice, setActiveVoice] = useState<string>('Media reader')
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  /** #334: this video's bookmarks (kept per video across sessions). */
  const [bookmarks, setBookmarks] = useState<MediaBookmark[]>([])
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null)
  /** Media length, for the bookmark ticks on the timeline (#334). */
  const [durationSec, setDurationSec] = useState<number | null>(null)
  // #364: the Exam tutor quiz in progress (questions only — answers stay in main).
  const [tutorQuiz, setTutorQuiz] = useState<TutorQuiz | null>(null)
  const [quizLoading, setQuizLoading] = useState(false)

  const refreshProjects = useCallback(async () => {
    if (!window.lkv?.media?.listProjects) return
    const list = await window.lkv.media.listProjects()
    setProjects(list)
  }, [])

  useEffect(() => {
    void refreshProjects()
  }, [refreshProjects])

  // Subscribe to main-process ingest progress so the UI can show a stage + cancel (#128).
  useEffect(() => {
    const unsubscribe = window.lkv?.media?.onIngestProgress?.((p) => {
      setIngestStage(p.stage)
    })
    return () => unsubscribe?.()
  }, [])

  const refreshVoices = useCallback(async (): Promise<MediaVoiceOption[]> => {
    if (!window.lkv?.prompts?.list) {
      setVoices([])
      return []
    }
    // Best-effort seed so chips appear without opening the voices plugin first
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

  // Poll playhead for HTML5 media. The player element is mounted once and only
  // rebinds when the media itself changes — fullscreen is a CSS change on the
  // same subtree (#327), so playback survives the toggle. On (re)bind the saved
  // playhead is re-applied, also once metadata loads (#329 resume).
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const onTime = () => setCurrentTime(el.currentTime || 0)
    el.addEventListener('timeupdate', onTime)
    // Scrubs while paused never fire timeupdate — 'seeked' covers them (#330).
    el.addEventListener('seeked', onTime)
    const applySaved = () => {
      const t = currentTimeRef.current
      if (t > 0) {
        try {
          el.currentTime = t
        } catch {
          /* not seekable yet */
        }
      }
    }
    applySaved()
    el.addEventListener('loadedmetadata', applySaved)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('seeked', onTime)
      el.removeEventListener('loadedmetadata', applySaved)
    }
  }, [active?.mediaProtocolUrl, active?.mediaPath])

  // #334: the media length places bookmark ticks under the player.
  useEffect(() => {
    setDurationSec(null)
    const el = videoRef.current
    if (!el) return
    const onDuration = () => {
      const d = el.duration
      setDurationSec(Number.isFinite(d) && d > 0 ? d : null)
    }
    onDuration()
    el.addEventListener('loadedmetadata', onDuration)
    el.addEventListener('durationchange', onDuration)
    return () => {
      el.removeEventListener('loadedmetadata', onDuration)
      el.removeEventListener('durationchange', onDuration)
    }
  }, [active?.mediaProtocolUrl, active?.mediaPath, active?.mediaUrl])

  // Esc exits fullscreen (the old MUI Dialog handled this for us; the fullscreen
  // layout is now a CSS overlay on the same player subtree, #327).
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  // #329: persist per-video state while a video is open — every 5 s, on
  // beforeunload, and once more when it closes or the video/project/voice/session
  // changes — so a comeback never loses more than ~5 s of playhead.
  const videoKey = active?.mediaUrl ?? active?.mediaPath ?? null
  useEffect(() => {
    if (!active || !videoKey || !window.lkv?.media?.setMediaState) return
    const save = () => {
      void window.lkv.media?.setMediaState?.({
        videoKey,
        project: active.project,
        sessionId,
        lastPositionSec: currentTimeRef.current,
        voice: activeVoice,
        followPlayhead,
      })
    }
    const iv = setInterval(save, 5000)
    window.addEventListener('beforeunload', save)
    return () => {
      clearInterval(iv)
      window.removeEventListener('beforeunload', save)
      save()
    }
  }, [active, videoKey, sessionId, activeVoice, followPlayhead])

  // #334: bookmarks belong to the video, so they come back with it.
  useEffect(() => {
    setEditingBookmarkId(null)
    setTutorQuiz(null) // #364: a quiz belongs to the video it was asked on
    if (!videoKey || !window.lkv?.media?.listBookmarks) {
      setBookmarks([])
      return
    }
    let cancelled = false
    void window.lkv.media
      .listBookmarks(videoKey)
      .then((list) => {
        if (!cancelled) setBookmarks(sortBookmarks(list))
      })
      .catch(() => {
        if (!cancelled) setBookmarks([])
      })
    return () => {
      cancelled = true
    }
  }, [videoKey])

  // #329: Media chat reopens the last video you studied when it mounts.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      // #334: a Study card made from a bookmark asked to reopen its moment.
      const pending = takePendingOpen()
      if (pending) {
        const projects = (await window.lkv?.media?.listProjects?.()) ?? []
        if (cancelled) return
        const proj =
          projects.find((x) => x.mediaUrl === pending.videoKey || x.mediaPath === pending.videoKey) ??
          projects.find((x) => !!pending.project && x.project === pending.project)
        if (proj) {
          await loadProject(proj)
          if (cancelled) return
          resumeSecRef.current = pending.positionSec
          setCurrentTime(pending.positionSec)
          setStatus(`Opened “${proj.project}” at ${formatHms(pending.positionSec)}`)
          return
        }
        setStatus('The video for that card is no longer in Media chat.')
        return
      }
      const last = await window.lkv?.media?.getLatestMediaState?.()
      if (!last || cancelled) return
      const projects = (await window.lkv?.media?.listProjects?.()) ?? []
      if (cancelled) return
      const proj = projects.find((x) => x.project === last.project)
      if (proj) await loadProject(proj)
      else if (!cancelled) setStatus(`Last opened “${last.project}”, which no longer exists.`)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Near-playhead note count (informational). Leading + trailing throttle:
  // playback fires timeupdate ~4/s and the YouTube poll fires 1/s, but each tick
  // is an IPC round-trip + full project scan, so at most one scan every 2 s —
  // and the last change of a burst always gets its scan (#330), so the count
  // settles on the new position after a seek even while paused.
  useEffect(() => {
    if (!active || !window.lkv?.media?.notesNear) {
      setNearCount(null)
      return
    }
    let cancelled = false
    const scan = async () => {
      try {
        const notes = await window.lkv.media.notesNear({
          project: active.project,
          centerSec: currentTime,
          windowSec: playheadWindowSec,
        })
        if (!cancelled) setNearCount(notes.length)
      } catch {
        if (!cancelled) setNearCount(null)
      }
    }
    const remaining = notesNearAtRef.current + 2000 - Date.now()
    if (remaining <= 0) {
      notesNearAtRef.current = Date.now()
      void scan()
    } else {
      const timer = setTimeout(() => {
        if (cancelled) return
        notesNearAtRef.current = Date.now()
        void scan()
      }, remaining)
      return () => {
        cancelled = true
        clearTimeout(timer)
      }
    }
    return () => {
      cancelled = true
    }
  }, [active, currentTime, playheadWindowSec])

  // YouTube embed URL comes from the main process (single hardened parser), and the
  // IFrame API player is created once the iframe exists.
  useEffect(() => {
    let cancelled = false
    ytPlayerRef.current?.destroy()
    ytPlayerRef.current = null
    setYtReady(false)
    setYtVideoId(null)
    if (!active?.mediaUrl || !window.lkv?.media?.youtubeEmbedUrl) {
      setEmbedUrl(null)
      return
    }
    void window.lkv.media
      .youtubeEmbedUrl(active.mediaUrl)
      .then((url) => {
        if (cancelled) return
        if (!url) {
          setEmbedUrl(null)
          return
        }
        // No origin= param: the IFrame API uses it as the postMessage target for
        // the embedding page, and no value matches a file:// renderer, so player
        // events would never arrive (#117). Error 153 in packaged builds is
        // handled by the main-process Referer/Origin rewrite (#24, #116).
        setEmbedUrl(url)
        setYtVideoId(videoIdFromEmbedUrl(url))
      })
      .catch(() => {
        if (!cancelled) setEmbedUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [active?.mediaUrl])

  // Create the YT player once the iframe is mounted; poll the playhead while playing.
  useEffect(() => {
    if (!embedUrl || !ytVideoId) return
    let cancelled = false
    let poll: ReturnType<typeof setInterval> | null = null
    const mount = async () => {
      try {
        await loadYouTubeIframeApi()
      } catch {
        return // embed still plays; seek/follow-playhead stay unavailable
      }
      if (cancelled || !ytFrameRef.current || !window.YT?.Player) return
      try {
        ytPlayerRef.current?.destroy()
      } catch {
        /* ignore */
      }
      // Poll unconditionally (not only while playing): a paused scrub must move
      // the playhead too, or "Ask about this moment" uses the old time (#330).
      const player = new window.YT.Player(ytFrameRef.current, {
        events: {
          onReady: () => {
            if (!cancelled) setYtReady(true)
            // Resume the saved playhead once the player can seek (#329).
            const resume = resumeSecRef.current
            if (resume > 0) {
              try {
                player.seekTo(resume, true)
                if (!cancelled) setCurrentTime(resume)
              } catch {
                /* ignore */
              }
              resumeSecRef.current = 0
            }
          },
        },
      })
      ytPlayerRef.current = player
      poll = setInterval(() => {
        if (cancelled) return
        try {
          const t = player.getCurrentTime()
          if (Number.isFinite(t)) setCurrentTime(t)
          const d = player.getDuration?.()
          if (typeof d === 'number' && Number.isFinite(d) && d > 0) setDurationSec((prev) => (prev === d ? prev : d))
        } catch {
          /* player gone */
        }
      }, 1000)
    }
    void mount()
    return () => {
      cancelled = true
      if (poll) clearInterval(poll)
      try {
        ytPlayerRef.current?.destroy()
      } catch {
        /* ignore */
      }
      ytPlayerRef.current = null
      setYtReady(false)
    }
  }, [embedUrl, ytVideoId])

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
    setFsNote(null)
    setSessionId(null)
    setCurrentTime(0)
    setStatus(
      `Ingested ${res.noteCount} transcript notes · project “${res.project}” · voice “${voice.name}”`
    )
    // Offer a move when the ingest ran on "Use file name" or the media layer
    // filed it somewhere else (its dedupe suffixes), #276.
    if (res.itemIds.length > 0 && (ingestProject === '' || res.project !== ingestProject)) {
      setMoveOffer({ itemIds: res.itemIds })
    } else {
      setMoveOffer(null)
    }
    await refreshProjects()
  }

  /** Post-ingest "Move N notes" (the move itself happens in MoveNotesAction). */
  const handleMoved = (project: string, count: number) => {
    setStatus(`Moved ${count} transcript note${count === 1 ? '' : 's'} to "${project}"`)
    setMoveOffer(null)
    void refreshProjects()
  }

  /** Pick the target project for the next ingest; remembered as "last used" (#276). */
  const onIngestProjectChange = (project: string) => {
    setIngestProject(project)
    saveImportProject(project)
  }

  const onPickLocal = async () => {
    if (!window.lkv?.media) return
    setError(null)
    setIngestStage(null)
    setMoveOffer(null)
    setBusy(true)
    try {
      const pick = await window.lkv.media.pickLocal()
      if (pick.canceled || !pick.mediaPath || !pick.captionsPath) {
        if (pick.mediaPath && !pick.captionsPath) {
          setError('Captions (.srt / .vtt) are required for Media chat.')
        }
        return
      }
      const existing = await window.lkv.media.findExistingProject?.({ mediaPath: pick.mediaPath })
      if (existing && existing.noteCount > 0) {
        const ok = window.confirm(
          `"${existing.project}" already has ${existing.noteCount} transcript notes. ` +
            'Re-ingesting will replace them and break existing citations to those notes. Continue?'
        )
        if (!ok) return
      }
      const res = await window.lkv.media.ingestLocal({
        mediaPath: pick.mediaPath,
        captionsPath: pick.captionsPath,
        project: ingestProject || undefined,
      })
      await applyIngestResult(res)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'Ingest cancelled') setStatus('Ingest cancelled')
      else setError(msg)
    } finally {
      setIngestStage(null)
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
    setIngestStage(null)
    setMoveOffer(null)
    setBusy(true)
    try {
      const existing = await window.lkv.media.findExistingProject?.({ url })
      if (existing && existing.noteCount > 0) {
        const ok = window.confirm(
          `"${existing.project}" already has ${existing.noteCount} transcript notes. ` +
            'Re-ingesting will replace them and break existing citations to those notes. Continue?'
        )
        if (!ok) return
      }
      const res = await window.lkv.media.ingestYoutube({ url, project: ingestProject || undefined })
      await applyIngestResult(res)
      setYtUrl('')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'Ingest cancelled') setStatus('Ingest cancelled')
      else setError(msg)
    } finally {
      setIngestStage(null)
      setBusy(false)
    }
  }

  const loadProject = async (p: MediaProjectInfo) => {
    if (!window.lkv) return
    setError(null)
    setIngestOpen(false) // switching video re-collapses the ingest controls (#332)
    // Saved per-video state (if any) picks the voice and resumes the chat (#329)
    const videoKey = p.mediaUrl ?? p.mediaPath ?? null
    const saved = videoKey ? ((await window.lkv.media.getMediaState?.(videoKey)) ?? null) : null
    const opts = await refreshVoices()
    const voice = resolveVoicePrompt(opts, saved?.voice ?? readStoredVoiceName())
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
    setFsNote(null)
    setSessionId(null)
    if (!saved) {
      setCurrentTime(0)
      resumeSecRef.current = 0
      setStatus(`Loaded media project “${p.project}” (${p.noteCount} notes) · voice “${voice.name}”`)
      return
    }
    // Continue where you left off: same conversation, voice and playhead.
    setFollowPlayhead(saved.followPlayhead)
    setCurrentTime(saved.lastPositionSec)
    resumeSecRef.current = saved.lastPositionSec
    let restoredMsg = ''
    if (saved.sessionId) {
      const hist = await window.lkv.chat.listMessages(saved.sessionId)
      if (hist.length > 0) {
        setMessages(hist)
        setSessionId(saved.sessionId)
        restoredMsg = ` · chat continued (${hist.length} messages)`
      }
    }
    setStatus(
      `Loaded media project “${p.project}” (${p.noteCount} notes) · voice “${voice.name}”` +
        restoredMsg +
        (saved.lastPositionSec > 0 ? ` · resume at ${formatClock(saved.lastPositionSec)}` : '')
    )
  }

  const selectVoice = async (name: string) => {
    if (!window.lkv || !active) return
    const opt = voices.find((v) => v.name === name)
    if (!opt) {
      setError(`Voice “${name}” is not installed yet — open Media voices to install.`)
      return
    }
    // Voice packs are reusable across projects — only switch promptId (no per-video profiles)
    setActiveVoice(name)
    writeStoredVoiceName(name)
    setActive((prev) => (prev ? { ...prev, promptId: opt.promptId } : prev))
    // #329: a voice change styles the next answers; it must not silently erase
    // the conversation.
    setStatus(`Voice: ${name} — your conversation stays (New chat starts fresh).`)
  }

  const onRenameProject = async () => {
    if (!window.lkv?.projects || !active) return
    const next = renameValue.trim()
    if (!next || next === active.project) {
      setRenaming(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await window.lkv.projects.rename(active.project, next)
      setActive((prev) => (prev ? { ...prev, project: next, title: next } : prev))
      setStatus(`Renamed media project to “${next}”`)
      await refreshProjects()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setRenaming(false)
    }
  }

  const onDeleteProject = async () => {
    if (!window.lkv?.projects || !active) return
    if (!window.confirm(`Delete media project “${active.project}” and its notes?`)) return
    setBusy(true)
    setError(null)
    try {
      await window.lkv.projects.delete(active.project)
      setActive(null)
      setMessages([])
      setFsNote(null)
      setSessionId(null)
      setStatus(`Deleted media project “${active.project}”`)
      await refreshProjects()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const seekTo = (sec: number) => {
    resumeSecRef.current = 0 // a manual seek supersedes the saved resume point
    const el = videoRef.current
    if (el) {
      el.currentTime = sec
      void el.play?.()
      setCurrentTime(sec)
      return
    }
    const yt = ytPlayerRef.current
    // A player bound to an iframe that is no longer the mounted one would accept
    // the seek silently and leave the video unmoved (#327) — treat it as not ready.
    const attached = !!yt && (!yt.getIframe || yt.getIframe() === ytFrameRef.current)
    if (yt && ytReady && attached) {
      try {
        yt.seekTo(sec, true)
        setCurrentTime(sec)
        return
      } catch {
        /* fall through to the hint */
      }
    }
    // YouTube player not ready (or API blocked) — show hint
    setStatus(`Seek target ${formatClock(sec)} — play the video first, or use local media for click-to-seek.`)
  }

  /** #365: a checkpoint pauses gently — local media or the YouTube player. */
  const pausePlayer = () => {
    const el = videoRef.current
    if (el) {
      el.pause?.()
      return
    }
    try {
      ytPlayerRef.current?.pauseVideo?.()
    } catch {
      /* player gone */
    }
  }

  /** #329: start a fresh conversation; the previous session stays in Ask's history. */
  const onNewChat = () => {
    setMessages([])
    setSessionId(null)
    setFsNote(null)
    setStatus('Started a new chat — the previous conversation is still in Ask.')
  }

  const onCitationClick = async (id: string) => {
    if (!window.lkv) return
    const item = await window.lkv.items.get(id)
    if (item) {
      const t = parseTStart(item.body)
      if (t != null) seekTo(t)
      // #328: in fullscreen the note drawer would open *behind* the overlay —
      // hidden, but focus-stealing (Esc stopped working). Show the passage
      // inside fullscreen instead; the drawer still serves normal mode.
      if (fullscreen) {
        setFsNote({
          title: item.title,
          body: item.body.replace(/^\s*t_start:\s*[0-9.]+\s*\n?/, ''),
        })
        return
      }
      onOpenNote?.(id)
    } else if (fullscreen) {
      setStatus(`Note ${id} is not in your vault.`)
    } else {
      onOpenNote?.(id)
    }
  }

  /**
   * The player's time right now — not the last-polled state (#330). While
   * paused the poll may lag a scrub; reading the player at the moment of use
   * keeps "Ask about this moment" / "Save this moment" on the real position.
   */
  const readPlayerTime = (): number => {
    const el = videoRef.current
    if (el && Number.isFinite(el.currentTime)) {
      return el.currentTime
    }
    const yt = ytPlayerRef.current
    if (yt && ytReady) {
      try {
        const t = yt.getCurrentTime()
        if (Number.isFinite(t)) return t
      } catch {
        /* player gone */
      }
    }
    return currentTime
  }

  const buildQuestion = (raw: string, forceMoment: boolean, sec: number): string => {
    const q = raw.trim()
    if (!forceMoment && !followPlayhead) return q
    const clock = formatClock(sec)
    const windowHint =
      nearCount != null
        ? ` (~${nearCount} transcript notes near ${windowLabel(playheadWindowSec)})`
        : ''
    return `[At ${clock} in the media${windowHint}] ${q}`
  }

  /** Save the transcript passage near the playhead as an AI-draft note. */
  const saveMoment = async () => {
    if (!active || !onNewDraft || !window.lkv?.media?.notesNear) return
    const momentSec = readPlayerTime()
    setCurrentTime(momentSec)
    setBusy(true)
    setError(null)
    try {
      const notes = await window.lkv.media.notesNear({ project: active.project, centerSec: momentSec, windowSec: playheadWindowSec })
      // notesNear returns chunks in t_start order (#331); show each with its
      // clock time and without the machine metadata lines.
      const passage =
        notes
          .map((n) => transcriptPassageChunk(n.body, formatClock(parseTStart(n.body) ?? momentSec)))
          .filter(Boolean)
          .join('\n\n') || '(no transcript near this moment)'
      onNewDraft({
        title: `Media moment — ${formatClock(momentSec)}`,
        body:
          provenanceHeader({
            sourceUrl: active.mediaUrl ?? active.mediaPath,
            tStart: Math.max(0, Math.round(momentSec - playheadWindowSec)),
            tEnd: Math.round(momentSec + playheadWindowSec),
          }) +
          passage +
          '\n\n## In my words\n\n',
        kind: 'note',
        para: 'resources',
        status: AI_DRAFT_STATUS,
        project: active.project,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /* ---- Exam tutor (#364) ---- */

  /** Quiz me on the transcript around the playhead, or around a bookmark. */
  const startQuiz = async (bookmark?: MediaBookmark) => {
    if (!active || !videoKey || !window.lkv?.media?.tutorQuiz || quizLoading) return
    const sec = bookmark ? bookmark.positionSec : readPlayerTime()
    if (!bookmark) setCurrentTime(sec)
    setQuizLoading(true)
    setError(null)
    try {
      const quiz = await window.lkv.media.tutorQuiz({
        videoKey,
        project: active.project,
        centerSec: sec,
        windowSec: playheadWindowSec,
        bookmarkId: bookmark?.id,
        count: 2,
      })
      setTutorQuiz(quiz)
      setStatus(
        `Exam tutor: ${quiz.questions.length} question${quiz.questions.length === 1 ? '' : 's'} on ${formatHms(quiz.windowStartSec)}–${formatHms(quiz.windowEndSec)}. Answer from memory first.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setQuizLoading(false)
    }
  }

  const onTutorPractice = (r: TutorPracticeResult) => {
    setBookmarks((prev) => sortBookmarks([...prev.filter((x) => x.id !== r.bookmark.id), r.bookmark]))
  }

  const onSend = async (opts?: { aboutMoment?: boolean; bookmark?: MediaBookmark; summarize?: MediaBookmark[] }) => {
    if (!window.lkv || !active || sending) return
    const bookmark = opts?.bookmark
    const summarize = opts?.summarize?.length ? opts.summarize : undefined
    if (!bookmark && !summarize && !chatInput.trim()) return
    // #364: "quiz me" starts the Exam tutor quiz at the playhead instead of a chat turn.
    if (!bookmark && !summarize && isQuizRequest(chatInput)) {
      setChatInput('')
      void startQuiz()
      return
    }
    const typed = chatInput
    // Read the player at click time so a paused scrub is not sent as the old
    // position (#330); sync the chip while we're at it.
    const momentSec = bookmark ? bookmark.positionSec : readPlayerTime()
    if (!bookmark) setCurrentTime(momentSec)
    // #334: a bookmark question is about the window around the bookmark; the
    // summary retrieves the window around every bookmark.
    const text = bookmark
      ? bookmarkQuestion(bookmark, typed)
      : summarize
        ? summarizeQuestion(summarize)
        : buildQuestion(typed, !!opts?.aboutMoment, momentSec)
    const rawInput = bookmark
      ? typed.trim()
        ? `${typed.trim()} — bookmark ${describeBookmark(bookmark)}`
        : `Ask about bookmark ${describeBookmark(bookmark)}`
      : summarize
        ? 'Summarize my bookmarks'
        : typed
    const optimisticId = `local_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    setChatInput('')
    setSending(true)
    setBusy(true)
    setError(null)
    // Render the user's message immediately rather than waiting for the reply.
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        session_id: sessionId ?? '',
        role: 'user',
        content: rawInput,
        uncited: false,
        citations_json: null,
        hits_json: null,
        provider_json: null,
        created_at: new Date().toISOString(),
      },
    ])
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
        // Store the question as typed; the playhead prefix is context for the
        // model and for retrieval, not for the history (#329, #161).
        displayContent: rawInput,
        filters: { project: active.project },
        promptId: active.promptId || undefined,
        sourcesLast: false, // Media chat is chat with the video: transcripts rank normally
        // #161: Follow playhead / "Ask about this moment" scope retrieval to the
        // playhead window, so the answer is grounded in the notes around now.
        mediaWindow:
          bookmark || followPlayhead || !!opts?.aboutMoment
            ? { centerSec: momentSec, windowSec: playheadWindowSec }
            : undefined,
        mediaWindows: summarize?.map((b) => ({ centerSec: b.positionSec, windowSec: playheadWindowSec })),
        limit: summarize ? 20 : 8,
      })
      setMessages(res.messages)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      // A failed send must not lose the question: roll back the optimistic
      // bubble and put the text back in the composer (#128).
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
      setChatInput(typed)
    } finally {
      setSending(false)
      setBusy(false)
    }
  }

  /* ---- Bookmarks (#334) ---- */

  /** Bookmark the moment playing now; opens its label editor. */
  const addBookmarkNow = async () => {
    if (!active || !videoKey || !window.lkv?.media?.addBookmark) return
    const sec = readPlayerTime()
    setCurrentTime(sec)
    try {
      const b = await window.lkv.media.addBookmark({
        videoKey,
        project: active.project,
        videoTitle: active.title,
        sourceType: active.sourceType,
        positionSec: sec,
      })
      setBookmarks((prev) => sortBookmarks([...prev.filter((x) => x.id !== b.id), b]))
      setEditingBookmarkId(b.id)
      setStatus(`Bookmarked ${formatHms(b.positionSec)} — add a label or tag, or keep watching.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // `B` bookmarks the moment — never while typing (Ask box, label fields), and
  // in fullscreen too: the listener is on the window, the overlay stays put.
  const addBookmarkRef = useRef(addBookmarkNow)
  addBookmarkRef.current = addBookmarkNow
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (!isBookmarkShortcut(e)) return
      e.preventDefault()
      void addBookmarkRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  const updateBookmark = async (id: string, patch: { label: string; tag: string | null }) => {
    if (!window.lkv?.media?.updateBookmark) return
    try {
      const b = await window.lkv.media.updateBookmark({ id, ...patch })
      if (b) setBookmarks((prev) => sortBookmarks(prev.map((x) => (x.id === id ? b : x))))
      else setBookmarks((prev) => prev.filter((x) => x.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const deleteBookmark = async (id: string) => {
    if (!window.lkv?.media?.deleteBookmark) return
    const b = bookmarks.find((x) => x.id === id)
    try {
      await window.lkv.media.deleteBookmark(id)
      setBookmarks((prev) => prev.filter((x) => x.id !== id))
      if (b) setStatus(`Deleted the bookmark at ${formatHms(b.positionSec)}${b.cardId ? ' (its Study card stays)' : ''}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const makeBookmarkCards = async () => {
    if (!active || !videoKey || !window.lkv?.media?.bookmarkCards) return
    setBusy(true)
    setError(null)
    try {
      const res = await window.lkv.media.bookmarkCards({ videoKey, project: active.project, windowSec: playheadWindowSec })
      const made = res.created
      setStatus(
        made === 0
          ? 'Every bookmark already has a Study card.'
          : `Made ${made} Study card${made === 1 ? '' : 's'} in “${active.project}”` +
              (res.existing > 0 ? ` (${res.existing} already had one)` : '') +
              ' — Confused bookmarks come up first.',
      )
      const list = await window.lkv.media.listBookmarks(videoKey)
      setBookmarks(sortBookmarks(list))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /** Export: the bookmarks as a Markdown note in the project, with timestamp links. */
  const saveBookmarksAsNote = async () => {
    if (!active || !videoKey || !onNewDraft || !window.lkv?.media?.bookmarksMarkdown) return
    try {
      const md = await window.lkv.media.bookmarksMarkdown({ videoKey })
      if (!md) return
      onNewDraft({
        title: `Bookmarks — ${active.title}`.slice(0, 80),
        body: md,
        kind: 'note',
        para: 'resources',
        project: active.project,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const mediaSrc = active?.mediaProtocolUrl
  const useAudio = isAudioPath(active?.mediaPath)

  const emptyHint = useMemo(
    () =>
      active
        ? activeVoice === 'Exam tutor'
          ? 'Exam tutor quizzes you instead of answering: press “Quiz me on this part” (or type “quiz me”), answer from memory, then see the cited answer.'
          : 'Ask about this media — answers cite transcript notes (itm_). Click a citation to seek.'
        : 'Ingest a local file + captions, or a YouTube URL, then chat grounded in the transcript.',
    [active, activeVoice]
  )

  const exitFullscreen = useCallback(() => {
    setFullscreen(false)
    setFsNote(null)
  }, [])

  const renderPlayerControls = () => (
    <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
      <Chip size="small" label={`Now: ${formatClock(currentTime)}`} />
      {nearCount != null && (
        <Chip size="small" variant="outlined" label={`${nearCount} notes near playhead`} />
      )}
      {active && onNewDraft && (
        <Button size="small" variant="outlined" disabled={busy} onClick={() => void saveMoment()}>
          Save this moment
        </Button>
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
      <TextField
        select
        size="small"
        label="Window"
        value={playheadWindowSec}
        onChange={(e) => {
          const v = Number(e.target.value)
          setPlayheadWindowSec(v)
          savePlayheadWindowSec(v)
        }}
        sx={{ minWidth: 96 }}
      >
        {PLAYHEAD_WINDOW_OPTIONS.map((sec) => (
          <MenuItem key={sec} value={sec}>
            {windowLabel(sec)}
          </MenuItem>
        ))}
      </TextField>
      <Button
        size="small"
        variant="outlined"
        disabled={!active || busy || !chatInput.trim()}
        onClick={() => void onSend({ aboutMoment: true })}
      >
        Ask about this moment
      </Button>
      <Button
        size="small"
        variant={activeVoice === 'Exam tutor' ? 'contained' : 'outlined'}
        disabled={!active || busy || quizLoading}
        onClick={() => void startQuiz()}
      >
        {quizLoading ? 'Writing questions…' : 'Quiz me on this part'}
      </Button>
      <Button size="small" variant="text" disabled={!active || busy || sending} onClick={onNewChat}>
        New chat
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
              ref={ytFrameRef}
              title="YouTube"
              src={embedUrl}
              referrerPolicy="strict-origin-when-cross-origin"
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

        {/* #334: bookmark ticks under the player; added after the player
            element so the <video>/<iframe> never remounts. */}
        <BookmarkTimeline bookmarks={bookmarks} durationSec={durationSec} currentTime={currentTime} onSeek={seekTo} />

        {active?.mediaUrl && (
          <Typography variant="caption" color="text.secondary">
            Watch:{' '}
            <Link
              component="button"
              type="button"
              onClick={() => {
                const u = active?.mediaUrl
                if (u) void window.lkv?.app?.openExternal(u)
              }}
            >
              {active.mediaUrl}
            </Link>
          </Typography>
        )}

        {renderPlayerControls()}
        {active?.sourceType === 'youtube' && (
          <Typography variant="caption" color="text.secondary">
            {ytReady
              ? 'Click a citation to seek; “Ask about this moment” uses the playhead.'
              : 'Loading the YouTube player… citation seek activates once it is ready.'}{' '}
            If the embedded player fails to load, use the “Watch” link above to open the video in your
            browser, or prefer local media for full seek sync.
          </Typography>
        )}
        {active && (
          <BookmarksPanel
            bookmarks={bookmarks}
            busy={busy || sending}
            editingId={editingBookmarkId}
            onEdit={setEditingBookmarkId}
            onAdd={() => void addBookmarkNow()}
            onSeek={seekTo}
            onUpdate={(id, patch) => void updateBookmark(id, patch)}
            onDelete={(id) => void deleteBookmark(id)}
            onAsk={(b) => void onSend({ bookmark: b })}
            onQuiz={(b) => void startQuiz(b)}
            onSummarize={() => void onSend({ summarize: bookmarks })}
            onMakeCards={() => void makeBookmarkCards()}
            onSaveAsNote={onNewDraft ? () => void saveBookmarksAsNote() : undefined}
            large={grow}
          />
        )}
        {/* #365: notes while watching — in the player column so fullscreen keeps it. */}
        {active && videoKey && (
          <GuidePanel
            videoKey={videoKey}
            project={active.project}
            videoTitle={active.title}
            sourceType={active.sourceType}
            currentTime={currentTime}
            durationSec={durationSec}
            large={grow}
            readTime={readPlayerTime}
            onSeek={seekTo}
            onPause={pausePlayer}
            onSelectCitation={(id) => void onCitationClick(id)}
            onOpenNote={fullscreen ? undefined : onOpenNote}
          />
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

        {tutorQuiz && (
          <TutorPanel
            key={tutorQuiz.quizId}
            quiz={tutorQuiz}
            videoTitle={active?.title}
            sourceType={active?.sourceType}
            large={fillHeight}
            onSeek={seekTo}
            onSelectCitation={(id) => void onCitationClick(id)}
            onPractice={onTutorPractice}
            onClose={() => setTutorQuiz(null)}
          />
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
                    {m.role === 'assistant' ? (
                      // #353: format answers like Ask/Study (light Markdown +
                      // inline numbered citations) instead of raw text.
                      <AnswerText
                        text={m.content}
                        citations={cites}
                        onSelectCitation={(id) => void onCitationClick(id)}
                      />
                    ) : (
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {m.content}
                      </Typography>
                    )}
                    {cites.length > 0 && (
                      <CitationChips citations={cites} onSelectCitation={(id) => void onCitationClick(id)} />
                    )}
                    {m.role === 'assistant' && <AnswerProviderChip providerJson={m.provider_json} />}
                    {m.role === 'assistant' && onNewDraft && (
                      <Button
                        size="small"
                        sx={{ mt: 0.5 }}
                        onClick={() =>
                          onNewDraft({
                            title: (m.content.trim().split(/[?!.\n]/)[0] || 'Saved answer').slice(0, 60),
                            body: provenanceHeader({ citedIds: cites.map((c) => c.id) }) + m.content,
                            kind: 'note',
                            para: 'resources',
                            status: AI_DRAFT_STATUS,
                            project: active?.project ?? null,
                          })
                        }
                      >
                        Save as note
                      </Button>
                    )}
                  </Box>
                )
              })}
              {sending && (
                <Box
                  sx={{
                    alignSelf: 'flex-start',
                    bgcolor: 'action.hover',
                    px: 1.25,
                    py: 1,
                    borderRadius: 2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                  }}
                  data-testid="answering-indicator"
                >
                  <CircularProgress size={14} />
                  <Typography variant="body2" color="text.secondary">
                    Answering from your notes…
                  </Typography>
                </Box>
              )}
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

  // #327: the player+Ask subtree below mounts exactly once. Fullscreen hides the
  // surrounding content via `visibility` (the overlay resets it) instead of
  // unmounting anything, so the <video>/<iframe> — and the YT player bound to the
  // iframe — survive every toggle, and seek/playhead keep working.
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        p: 1.5,
        gap: 1.5,
        visibility: fullscreen ? 'hidden' : 'visible',
      }}
    >
      {!fullscreen && (
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
      )}

      {!fullscreen && status && (
        <Alert
          severity="success"
          onClose={() => {
            setStatus(null)
            setMoveOffer(null)
          }}
        >
          {status}
          {moveOffer && moveOffer.itemIds.length > 0 && (
            <MoveNotesAction itemIds={moveOffer.itemIds} onMoved={handleMoved} />
          )}
        </Alert>
      )}
      {!fullscreen && error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!fullscreen && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          {/* #332: with a video loaded, the ingest controls collapse behind an
              "Add media" toggle and the project switcher + rename/delete sit in
              a one-line header, so the player, its controls and Ask fit one
              screen (a 1280×800 laptop). */}
          {active && (
            <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
              <TextField
                select
                size="small"
                label="Open media project"
                value={active.project}
                onChange={(e) => {
                  const p = projects.find((x) => x.project === e.target.value)
                  if (p) void loadProject(p)
                }}
                sx={{ minWidth: 220, flex: '1 1 auto' }}
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
              {renaming ? (
                <>
                  <TextField
                    size="small"
                    sx={{ minWidth: 180 }}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    label="Rename media project"
                    autoFocus
                  />
                  <Button
                    variant="contained"
                    size="small"
                    disabled={busy || !renameValue.trim() || renameValue.trim() === active.project}
                    onClick={() => void onRenameProject()}
                  >
                    Save
                  </Button>
                  <Button size="small" disabled={busy} onClick={() => setRenaming(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() => {
                      setRenaming(true)
                      setRenameValue(active.project)
                    }}
                  >
                    Rename
                  </Button>
                  <Button size="small" color="error" disabled={busy} onClick={() => void onDeleteProject()}>
                    Delete
                  </Button>
                </>
              )}
              <Box sx={{ flex: 1 }} />
              <Button
                size="small"
                startIcon={ingestOpen ? <ExpandLessIcon fontSize="small" /> : <AddIcon fontSize="small" />}
                onClick={() => setIngestOpen((v) => !v)}
                aria-label={ingestOpen ? 'Hide add media' : 'Add media'}
              >
                {ingestOpen ? 'Close' : 'Add media'}
              </Button>
            </Stack>
          )}
          {(!active || ingestOpen) && (
            <Stack spacing={1.25} sx={{ mt: active ? 1.25 : 0 }}>
              {!active && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
                >
                  Ingest
                </Typography>
              )}
              {/* #276: file the ingest into a project; "Use file name" keeps
                  deriving it from the media. */}
              <ProjectSelect
                value={ingestProject}
                onChange={onIngestProjectChange}
                label="Project"
                allLabel="Use file name"
              />
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
              {ingestStage && (
                <Stack spacing={0.75} data-testid="ingest-progress">
                  <LinearProgress />
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                      {ingestStage}
                    </Typography>
                    <Button
                      size="small"
                      color="error"
                      onClick={() => void window.lkv?.media?.cancelIngest?.()}
                    >
                      Cancel
                    </Button>
                  </Stack>
                </Stack>
              )}
              <Typography variant="caption" color="text.secondary">
                Captions become searchable transcript notes in your vault.
              </Typography>
              {!active && projects.length > 0 && (
                <TextField
                  select
                  size="small"
                  label="Open media project"
                  value=""
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
          )}
        </Paper>
      )}

      {/* #327: mounted exactly once — normal layout or fullscreen overlay. Toggling
          changes styles only, never the player DOM, so the <video> keeps playing and
          the YT player stays bound to its iframe. */}
      <Box
        sx={
          fullscreen
            ? {
                position: 'fixed',
                inset: 0,
                zIndex: 1300,
                visibility: 'visible',
                bgcolor: 'background.paper',
                p: 1.5,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                gap: 1.5,
              }
            : { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }
        }
      >
        {fullscreen && (
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
        )}

        {fullscreen && status && (
          <Alert severity="success" onClose={() => setStatus(null)}>
            {status}
            {moveOffer && moveOffer.itemIds.length > 0 && (
              <MoveNotesAction itemIds={moveOffer.itemIds} onMoved={handleMoved} />
            )}
          </Alert>
        )}
        {fullscreen && error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {renderPlayerAskLayout({ large: fullscreen })}

        {/* #328: the cited passage, shown inside fullscreen. The app-side note
            drawer stays closed here — it would render behind the overlay, hidden
            but focus-stealing (Esc stopped exiting fullscreen). */}
        {fullscreen && fsNote && (
          <Paper variant="outlined" sx={{ p: 1.25, maxHeight: 220, overflow: 'auto', flexShrink: 0 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                {fsNote.title}
              </Typography>
              <IconButton
                size="small"
                onClick={() => setFsNote(null)}
                aria-label="Close note passage"
                title="Close note passage"
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
            {/* #353: the cited passage formats Markdown like Ask/Study. */}
            <Box sx={{ mt: 0.5 }}>
              <AnswerText text={fsNote.body} />
            </Box>
          </Paper>
        )}
      </Box>
    </Box>
  )
}
