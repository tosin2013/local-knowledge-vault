/**
 * Study guide checkpoints (#365): small pure helpers for the guide panel.
 */
import type { MediaChapter, MediaGuide } from '../../../electron/types'
import { isTypingTarget } from './bookmarks'

export const CHECKPOINT_CHOICES = [5, 10, 15, 20, 30] as const
export const SNOOZE_SEC = 5 * 60
/** A jump of more than this past a checkpoint is a seek, not playback: no prompt. */
export const CHECKPOINT_SLACK_SEC = 15
/** Chapters shorter than this are merged into the next checkpoint. */
export const MIN_CHECKPOINT_SEC = 60

export interface NextCheckpoint {
  sec: number
  /** The chapter that ends here, when checkpoints follow chapters. */
  chapter: string | null
}

/**
 * When the next checkpoint falls: at the next chapter boundary when the video
 * has chapters, else every N minutes; never before a snooze ends; null when off
 * or past the end of the video. Pure.
 */
export function nextCheckpoint(
  opts: Pick<MediaGuide, 'checkpointMin' | 'checkpointsOff' | 'snoozedUntilSec'> & {
    anchorSec: number
    chapters?: MediaChapter[]
    durationSec?: number | null
  },
): NextCheckpoint | null {
  if (opts.checkpointsOff) return null
  const anchor = Math.max(0, opts.anchorSec || 0)
  let next: NextCheckpoint | null = null
  const chapter = (opts.chapters ?? []).find((c) => c.endSec >= anchor + MIN_CHECKPOINT_SEC)
  if (chapter) next = { sec: chapter.endSec, chapter: chapter.title || null }
  else if (!(opts.chapters ?? []).length) next = { sec: anchor + Math.max(1, opts.checkpointMin) * 60, chapter: null }
  if (!next) return null
  if (opts.snoozedUntilSec != null && opts.snoozedUntilSec > next.sec) next = { sec: opts.snoozedUntilSec, chapter: null }
  const d = Number(opts.durationSec)
  if (Number.isFinite(d) && d > 0 && next.sec > d + 1) return null
  return next
}

/** 'due' while playback crosses the checkpoint; 'jumped' after a seek far past it. Pure. */
export function checkpointState(timeSec: number, next: NextCheckpoint | null): 'none' | 'ahead' | 'due' | 'jumped' {
  if (!next) return 'none'
  if (timeSec < next.sec) return 'ahead'
  return timeSec - next.sec <= CHECKPOINT_SLACK_SEC ? 'due' : 'jumped'
}

/** The checkpoint shortcut: a bare `g` / `G`, not while typing. Pure. */
export function isCheckpointShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target' | 'repeat'>): boolean {
  if (e.key !== 'g' && e.key !== 'G') return false
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false
  return !isTypingTarget(e.target)
}
