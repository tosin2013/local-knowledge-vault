/**
 * Media chat bookmarks (#334): small pure helpers shared by the panel, the
 * player timeline and the Study reveal.
 */
import type { MediaBookmark, StudyMediaMoment } from '../../../electron/types'

/** Built-in tags in the order the panel offers them; anything else is custom. */
export const BOOKMARK_TAGS = ['Review', 'Confused', 'Exam'] as const

/** sessionStorage key for "open this video at this time" handed to Media chat. */
export const PENDING_OPEN_KEY = 'lkv.media.pendingOpen'
/** Window event the app listens for to open a plugin from anywhere. */
export const OPEN_PLUGIN_EVENT = 'lkv:open-plugin'

export function formatClock(sec: number): string {
  const t = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${mm}:${ss}`
  return `${mm}:${ss}`
}

/** Always h:mm:ss, as the bookmarks panel shows times. */
export function formatHms(sec: number): string {
  const t = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * True while the user is typing somewhere (the Ask box, a label field, a
 * select), so the `B` shortcut must not fire.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false
  const el = target as HTMLElement
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (el.isContentEditable) return true
  const role = el.getAttribute?.('role')
  return role === 'textbox' || role === 'combobox' || role === 'listbox' || role === 'option'
}

/** The bookmark shortcut: a bare `b` / `B`, no modifiers, not while typing. */
export function isBookmarkShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target' | 'repeat'>): boolean {
  if (e.key !== 'b' && e.key !== 'B') return false
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false
  return !isTypingTarget(e.target)
}

/** Sort by time (then creation), as the panel and timeline show them. */
export function sortBookmarks(list: MediaBookmark[]): MediaBookmark[] {
  return [...list].sort((a, b) => a.positionSec - b.positionSec || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
}

/** Where a tick sits on the timeline, 0–100 (%), or null when the length is unknown. */
export function tickPercent(positionSec: number, durationSec: number | null | undefined): number | null {
  const d = Number(durationSec)
  if (!Number.isFinite(d) || d <= 0) return null
  return Math.min(100, Math.max(0, (positionSec / d) * 100))
}

/** A bookmark as a short phrase for questions and status lines. */
export function describeBookmark(b: Pick<MediaBookmark, 'positionSec' | 'label' | 'tag'>): string {
  const parts = [formatHms(b.positionSec)]
  if (b.label) parts.push(`“${b.label}”`)
  if (b.tag) parts.push(`(${b.tag})`)
  return parts.join(' ')
}

/** The question sent for "Ask about this bookmark" (the model sees the window around it). */
export function bookmarkQuestion(b: Pick<MediaBookmark, 'positionSec' | 'label' | 'tag'>, typed: string): string {
  const q = typed.trim() || (b.tag === 'Confused' ? 'I was confused here — explain what is being said, simply.' : 'What is being explained at this moment?')
  return `[Bookmark at ${describeBookmark(b)} in the media] ${q}`
}

/** The question sent for "Summarize my bookmarks". */
export function summarizeQuestion(list: Array<Pick<MediaBookmark, 'positionSec' | 'label' | 'tag'>>): string {
  const lines = sortBookmarks(list as MediaBookmark[]).map((b) => `- ${describeBookmark(b)}`)
  return (
    'Summarize what the video says at each of my bookmarks, one short paragraph per bookmark, ' +
    `in time order, citing the transcript notes:\n${lines.join('\n')}`
  )
}

/** Hand a "reopen this moment" request to Media chat and open it (Study reveal, #334). */
export function openMediaMoment(moment: Pick<StudyMediaMoment, 'videoKey' | 'positionSec' | 'project'>): void {
  try {
    sessionStorage.setItem(
      PENDING_OPEN_KEY,
      JSON.stringify({ videoKey: moment.videoKey, positionSec: moment.positionSec, project: moment.project }),
    )
  } catch {
    /* storage unavailable: Media chat still opens on the last video */
  }
  window.dispatchEvent(new CustomEvent(OPEN_PLUGIN_EVENT, { detail: { id: 'media-chat' } }))
}

/** Read and clear a pending "open at" request. */
export function takePendingOpen(): { videoKey: string; positionSec: number; project?: string } | null {
  try {
    const raw = sessionStorage.getItem(PENDING_OPEN_KEY)
    if (!raw) return null
    sessionStorage.removeItem(PENDING_OPEN_KEY)
    const v = JSON.parse(raw) as { videoKey?: unknown; positionSec?: unknown; project?: unknown }
    const sec = Number(v.positionSec)
    if (typeof v.videoKey !== 'string' || !v.videoKey || !Number.isFinite(sec)) return null
    return { videoKey: v.videoKey, positionSec: Math.max(0, sec), project: typeof v.project === 'string' ? v.project : undefined }
  } catch {
    return null
  }
}
