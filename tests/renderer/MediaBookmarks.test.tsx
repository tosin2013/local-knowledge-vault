import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MediaChatView } from '../../src/plugins/media-chat/MediaChatView'
import { BookmarkTimeline, BookmarksPanel } from '../../src/plugins/media-chat/BookmarksPanel'
import {
  OPEN_PLUGIN_EVENT,
  PENDING_OPEN_KEY,
  bookmarkQuestion,
  describeBookmark,
  formatClock,
  formatHms,
  isBookmarkShortcut,
  isTypingTarget,
  openMediaMoment,
  sortBookmarks,
  summarizeQuestion,
  takePendingOpen,
  tickPercent,
} from '../../src/plugins/media-chat/bookmarks'
import { lkvMock, makeBookmark, makeIngestResult, makeMessage, makePrompt, makeSession } from './lkv'

const VIDEO_PATH = '/videos/lecture.mp4'

function seed() {
  const lkv = lkvMock()
  lkv.prompts.list.mockResolvedValue([makePrompt('prm_media_reader', 'Media reader')])
  lkv.media.ingestLocal.mockResolvedValue(
    makeIngestResult({ project: 'Lecture', title: 'Lecture', mediaPath: VIDEO_PATH, mediaProtocolUrl: 'lkvmedia://lecture' }),
  )
  lkv.media.pickLocal.mockResolvedValue({ canceled: false, mediaPath: VIDEO_PATH, captionsPath: '/videos/lecture.vtt' })
  lkv.chat.createSession.mockResolvedValue(makeSession('s_1'))
  lkv.chat.send.mockResolvedValue({
    assistant: makeMessage(),
    messages: [makeMessage({ id: 'msg_a', role: 'assistant', content: 'Here is the summary.' })],
    session: makeSession('s_1'),
    offline: false,
  })
  return lkv
}

/** Ingest the local lecture and return its (2-hour) video element. */
async function openLocal(container: HTMLElement): Promise<HTMLVideoElement> {
  fireEvent.click(screen.getByText('Local video/audio + captions'))
  const video = (await waitFor(() => {
    const el = container.querySelector('video')
    expect(el).not.toBeNull()
    return el!
  })) as HTMLVideoElement
  Object.defineProperty(video, 'duration', { configurable: true, value: 7200 })
  fireEvent(video, new Event('durationchange'))
  return video
}

afterEach(() => {
  sessionStorage.clear()
  delete (window as { YT?: unknown }).YT
})

describe('Media chat bookmarks (#334)', () => {
  it('the bookmark button saves the playhead (1:45:00 on a 2-hour video), shows it in the panel and as a tick', async () => {
    const lkv = seed()
    const { container } = render(<MediaChatView />)
    const video = await openLocal(container)
    await waitFor(() => expect(lkv.media.listBookmarks).toHaveBeenCalledWith(VIDEO_PATH))
    expect(screen.getByText(/Press B \(or the button\)/)).toBeInTheDocument()
    video.currentTime = 6300
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark (B)' }))
    await waitFor(() =>
      expect(lkv.media.addBookmark).toHaveBeenCalledWith({
        videoKey: VIDEO_PATH,
        project: 'Lecture',
        videoTitle: 'Lecture',
        sourceType: 'local',
        positionSec: 6300,
      }),
    )
    expect(await screen.findByText(/Bookmarked 1:45:00/)).toBeInTheDocument()
    // The new bookmark opens its label editor; save a label and a tag.
    fireEvent.change(screen.getByLabelText('Bookmark label'), { target: { value: 'exam topic' } })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /^Tag/ }))
    fireEvent.click(await screen.findByRole('option', { name: 'Exam' }))
    lkv.media.updateBookmark.mockResolvedValueOnce(
      makeBookmark({ id: 'bmk_1', videoKey: VIDEO_PATH, positionSec: 6300, label: 'exam topic', tag: 'Exam' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(lkv.media.updateBookmark).toHaveBeenCalledWith({ id: 'bmk_1', label: 'exam topic', tag: 'Exam' }))
    const row = await screen.findByTestId('bookmark-row')
    expect(within(row).getByText('1:45:00')).toBeInTheDocument()
    expect(within(row).getByText('exam topic')).toBeInTheDocument()
    expect(within(row).getByText('Exam')).toBeInTheDocument()
    const tick = screen.getByTestId('bookmark-tick')
    expect(tick).toHaveAttribute('data-pct', '87.50')
    expect(tick).toHaveAccessibleName('Bookmark at 1:45:00 — exam topic')
  })

  it('B bookmarks, but not while typing in Ask; it works in fullscreen without leaving it', async () => {
    const lkv = seed()
    const { container } = render(<MediaChatView />)
    const video = await openLocal(container)
    video.currentTime = 30
    const ask = screen.getByPlaceholderText('Ask about this media…')
    ask.focus()
    fireEvent.keyDown(ask, { key: 'b' })
    fireEvent.keyDown(ask, { key: 'B' })
    expect(lkv.media.addBookmark).not.toHaveBeenCalled()
    ask.blur()
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(lkv.media.addBookmark).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Enter fullscreen'))
    await screen.findByLabelText('Exit fullscreen')
    video.currentTime = 90
    fireEvent.keyDown(document.body, { key: 'b' })
    await waitFor(() => expect(lkv.media.addBookmark).toHaveBeenCalledWith(expect.objectContaining({ positionSec: 90 })))
    // Still fullscreen, same player element, and the panel is right there.
    expect(screen.getByLabelText('Exit fullscreen')).toBeInTheDocument()
    expect(container.querySelector('video')).toBe(video)
    expect(await screen.findByTestId('bookmark-row')).toBeInTheDocument()
  })

  it('reopening the video brings its bookmarks back; clicking one (or its tick) seeks', async () => {
    const lkv = seed()
    lkv.media.listBookmarks.mockResolvedValue([
      makeBookmark({ id: 'bmk_b', videoKey: VIDEO_PATH, positionSec: 6300, label: 'later', transcriptLine: 'the scheduler explained' }),
      makeBookmark({ id: 'bmk_a', videoKey: VIDEO_PATH, positionSec: 65, label: 'intro', tag: 'Review' }),
    ])
    const { container } = render(<MediaChatView />)
    const video = await openLocal(container)
    const rows = await screen.findAllByTestId('bookmark-row')
    expect(rows.map((r) => within(r).getByRole('button', { name: /Seek to/ }).textContent)).toEqual(['0:01:05', '1:45:00'])
    expect(screen.getByText('the scheduler explained')).toBeInTheDocument()
    expect(screen.getByText('Bookmarks (2)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Seek to 1:45:00' }))
    expect(video.currentTime).toBe(6300)
    expect(screen.getByText('Now: 1:45:00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark at 0:01:05 — intro' }))
    expect(video.currentTime).toBe(65)
  })

  it('asks about a bookmark (its window) and summarizes all of them', async () => {
    const lkv = seed()
    lkv.media.listBookmarks.mockResolvedValue([
      makeBookmark({ id: 'bmk_a', videoKey: VIDEO_PATH, positionSec: 65, label: 'intro' }),
      makeBookmark({ id: 'bmk_b', videoKey: VIDEO_PATH, positionSec: 6300, label: 'lost', tag: 'Confused' }),
    ])
    const { container } = render(<MediaChatView />)
    await openLocal(container)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask about the bookmark at 1:45:00' }))
    await waitFor(() => expect(lkv.chat.send).toHaveBeenCalledTimes(1))
    const first = lkv.chat.send.mock.calls[0][0]
    expect(first.text).toBe('[Bookmark at 1:45:00 “lost” (Confused) in the media] I was confused here — explain what is being said, simply.')
    expect(first.displayContent).toBe('Ask about bookmark 1:45:00 “lost” (Confused)')
    expect(first.mediaWindow).toEqual({ centerSec: 6300, windowSec: 45 })
    expect(await screen.findByText('Here is the summary.')).toBeInTheDocument()

    // A typed question is asked about the bookmark instead of the default one.
    fireEvent.change(screen.getByPlaceholderText('Ask about this media…'), { target: { value: 'why does it matter?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask about the bookmark at 0:01:05' }))
    await waitFor(() => expect(lkv.chat.send).toHaveBeenCalledTimes(2))
    expect(lkv.chat.send.mock.calls[1][0].text).toBe('[Bookmark at 0:01:05 “intro” in the media] why does it matter?')
    expect(lkv.chat.send.mock.calls[1][0].displayContent).toBe('why does it matter? — bookmark 0:01:05 “intro”')

    fireEvent.click(screen.getByRole('button', { name: 'Summarize my bookmarks' }))
    await waitFor(() => expect(lkv.chat.send).toHaveBeenCalledTimes(3))
    const sum = lkv.chat.send.mock.calls[2][0]
    expect(sum.displayContent).toBe('Summarize my bookmarks')
    expect(sum.mediaWindows).toEqual([
      { centerSec: 65, windowSec: 45 },
      { centerSec: 6300, windowSec: 45 },
    ])
    expect(sum.limit).toBe(20)
    expect(sum.text).toContain('- 0:01:05 “intro”')
  })

  it('makes Study cards from bookmarks once, then says every bookmark has one', async () => {
    const lkv = seed()
    lkv.media.listBookmarks.mockResolvedValueOnce([makeBookmark({ id: 'bmk_a', videoKey: VIDEO_PATH, positionSec: 65 })])
    const { container } = render(<MediaChatView />)
    await openLocal(container)
    await screen.findByTestId('bookmark-row')
    lkv.media.bookmarkCards.mockResolvedValueOnce({ created: 1, existing: 0, cards: [{ bookmarkId: 'bmk_a', cardId: 'crd_1', itemId: 'itm_9', created: true }] })
    lkv.media.listBookmarks.mockResolvedValueOnce([makeBookmark({ id: 'bmk_a', videoKey: VIDEO_PATH, positionSec: 65, cardId: 'crd_1' })])
    fireEvent.click(screen.getByRole('button', { name: 'Make cards from bookmarks' }))
    await waitFor(() => expect(lkv.media.bookmarkCards).toHaveBeenCalledWith({ videoKey: VIDEO_PATH, project: 'Lecture', windowSec: 45 }))
    expect(await screen.findByText(/Made 1 Study card in “Lecture”/)).toBeInTheDocument()
    expect(await screen.findByText('Card')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make cards from bookmarks' })).toBeDisabled()
  })

  it('reports card errors and an all-done run', async () => {
    const lkv = seed()
    lkv.media.listBookmarks.mockResolvedValue([makeBookmark({ id: 'bmk_a', videoKey: VIDEO_PATH, positionSec: 65 })])
    const { container } = render(<MediaChatView />)
    await openLocal(container)
    await screen.findByTestId('bookmark-row')
    lkv.media.bookmarkCards.mockRejectedValueOnce(new Error('cards failed'))
    fireEvent.click(screen.getByRole('button', { name: 'Make cards from bookmarks' }))
    expect(await screen.findByText('cards failed')).toBeInTheDocument()
    lkv.media.bookmarkCards.mockResolvedValueOnce({ created: 0, existing: 1, cards: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Make cards from bookmarks' }))
    expect(await screen.findByText('Every bookmark already has a Study card.')).toBeInTheDocument()
  })

  it('edits, cancels and deletes a bookmark; saves the list as a Markdown note', async () => {
    const lkv = seed()
    lkv.media.listBookmarks.mockResolvedValue([
      makeBookmark({ id: 'bmk_a', videoKey: VIDEO_PATH, positionSec: 65, label: 'intro', tag: 'Later', cardId: 'crd_1' }),
    ])
    lkv.media.bookmarksMarkdown.mockResolvedValue('## Bookmarks — Lecture\n\n- [0:01:05](file:///videos/lecture.mp4#t=65) **intro**\n')
    const onNewDraft = vi.fn()
    const { container } = render(<MediaChatView onNewDraft={onNewDraft} />)
    await openLocal(container)
    await screen.findByTestId('bookmark-row')
    // A custom tag opens as "Custom…" with its text.
    fireEvent.click(screen.getByRole('button', { name: 'Edit the bookmark at 0:01:05' }))
    expect(screen.getByLabelText('Custom tag')).toHaveValue('Later')
    fireEvent.keyDown(screen.getByLabelText('Bookmark label'), { key: 'Escape' })
    expect(screen.queryByLabelText('Bookmark label')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit the bookmark at 0:01:05' }))
    fireEvent.change(screen.getByLabelText('Custom tag'), { target: { value: 'week 3' } })
    lkv.media.updateBookmark.mockResolvedValueOnce(
      makeBookmark({ id: 'bmk_a', videoKey: VIDEO_PATH, positionSec: 65, label: 'intro', tag: 'week 3', cardId: 'crd_1' }),
    )
    fireEvent.keyDown(screen.getByLabelText('Bookmark label'), { key: 'Enter' })
    await waitFor(() => expect(lkv.media.updateBookmark).toHaveBeenCalledWith({ id: 'bmk_a', label: 'intro', tag: 'week 3' }))

    fireEvent.click(screen.getByRole('button', { name: 'Save as note' }))
    await waitFor(() =>
      expect(onNewDraft).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Bookmarks — Lecture', project: 'Lecture', body: expect.stringContaining('#t=65') }),
      ),
    )
    expect(lkv.media.bookmarksMarkdown).toHaveBeenCalledWith({ videoKey: VIDEO_PATH })

    fireEvent.click(screen.getByRole('button', { name: 'Delete the bookmark at 0:01:05' }))
    await waitFor(() => expect(lkv.media.deleteBookmark).toHaveBeenCalledWith('bmk_a'))
    expect(await screen.findByText(/Deleted the bookmark at 0:01:05 \(its Study card stays\)/)).toBeInTheDocument()
    expect(screen.queryByTestId('bookmark-row')).toBeNull()
  })

  it('shows repository errors instead of failing silently', async () => {
    const lkv = seed()
    lkv.media.listBookmarks.mockResolvedValue([makeBookmark({ id: 'bmk_a', videoKey: VIDEO_PATH, positionSec: 65 })])
    const { container } = render(<MediaChatView />)
    await openLocal(container)
    await screen.findByTestId('bookmark-row')
    lkv.media.addBookmark.mockRejectedValueOnce(new Error('add failed'))
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark (B)' }))
    expect(await screen.findByText('add failed')).toBeInTheDocument()
    lkv.media.deleteBookmark.mockRejectedValueOnce(new Error('delete failed'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete the bookmark at 0:01:05' }))
    expect(await screen.findByText('delete failed')).toBeInTheDocument()
    // An edit of a bookmark deleted elsewhere drops it from the list.
    lkv.media.updateBookmark.mockResolvedValueOnce(null)
    fireEvent.click(screen.getByRole('button', { name: 'Edit the bookmark at 0:01:05' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByTestId('bookmark-row')).toBeNull())
  })

  it('YouTube: ticks use the player length and a bookmark seeks the player', async () => {
    const lkv = seed()
    const seekTo = vi.fn()
    ;(window as unknown as { YT: unknown }).YT = {
      Player: vi.fn().mockImplementation(function (this: unknown, el: HTMLIFrameElement, opts: { events?: { onReady?: () => void } }) {
        setTimeout(() => opts.events?.onReady?.(), 0)
        return {
          seekTo,
          getCurrentTime: () => 6300,
          getDuration: () => 7200,
          getPlayerState: () => 1,
          destroy: () => {},
          getIframe: () => el,
        }
      }),
    }
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      lkv.media.youtubeEmbedUrl.mockResolvedValue('https://www.youtube-nocookie.com/embed/abc123abc12?enablejsapi=1')
      lkv.media.ingestYoutube.mockResolvedValue(
        makeIngestResult({ project: 'Talk', title: 'Talk', sourceType: 'youtube', mediaUrl: 'https://www.youtube.com/watch?v=abc123abc12' }),
      )
      lkv.media.listBookmarks.mockResolvedValue([
        makeBookmark({ id: 'bmk_y', videoKey: 'https://www.youtube.com/watch?v=abc123abc12', sourceType: 'youtube', positionSec: 3600 }),
      ])
      render(<MediaChatView />)
      fireEvent.change(screen.getByPlaceholderText(/youtube.com\/watch/), { target: { value: 'https://youtube.com/watch?v=abc123abc12' } })
      fireEvent.click(screen.getByText('Ingest YouTube'))
      await screen.findByTestId('bookmark-row')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500)
      })
      const tick = await screen.findByTestId('bookmark-tick')
      expect(tick).toHaveAttribute('data-pct', '50.00')
      fireEvent.click(screen.getByRole('button', { name: 'Seek to 1:00:00' }))
      expect(seekTo).toHaveBeenCalledWith(3600, true)
      // B reads the player's own time.
      fireEvent.keyDown(window, { key: 'B' })
      await waitFor(() => expect(lkv.media.addBookmark).toHaveBeenCalledWith(expect.objectContaining({ positionSec: 6300, sourceType: 'youtube' })))
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens the video at a bookmark when a Study card asks for it', async () => {
    const lkv = seed()
    lkv.media.listProjects.mockResolvedValue([
      { project: 'Lecture', noteCount: 240, sourceType: 'local', mediaPath: VIDEO_PATH, mediaProtocolUrl: 'lkvmedia://lecture', updatedAt: '2026-10-01T00:00:00.000Z' },
    ])
    sessionStorage.setItem(PENDING_OPEN_KEY, JSON.stringify({ videoKey: VIDEO_PATH, positionSec: 6300, project: 'Lecture' }))
    const { container } = render(<MediaChatView />)
    expect(await screen.findByText(/Opened “Lecture” at 1:45:00/)).toBeInTheDocument()
    await waitFor(() => expect((container.querySelector('video') as HTMLVideoElement).currentTime).toBe(6300))
    expect(lkv.media.getLatestMediaState).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(PENDING_OPEN_KEY)).toBeNull()
  })

  it('says so when the bookmarked video is gone', async () => {
    seed()
    sessionStorage.setItem(PENDING_OPEN_KEY, JSON.stringify({ videoKey: '/gone.mp4', positionSec: 5 }))
    render(<MediaChatView />)
    expect(await screen.findByText('The video for that card is no longer in Media chat.')).toBeInTheDocument()
  })
})

describe('bookmark helpers (#334)', () => {
  it('formats times', () => {
    expect(formatHms(6300)).toBe('1:45:00')
    expect(formatHms(65.9)).toBe('0:01:05')
    expect(formatHms(-3)).toBe('0:00:00')
    expect(formatClock(65)).toBe('01:05')
    expect(formatClock(3725)).toBe('1:02:05')
  })

  it('knows when the user is typing', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const div = document.createElement('div')
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    const combo = document.createElement('div')
    combo.setAttribute('role', 'combobox')
    expect(isTypingTarget(input)).toBe(true)
    expect(isTypingTarget(textarea)).toBe(true)
    expect(isTypingTarget(document.createElement('select'))).toBe(true)
    expect(isTypingTarget(editable)).toBe(true)
    expect(isTypingTarget(combo)).toBe(true)
    expect(isTypingTarget(div)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget(window)).toBe(false)
    const base = { ctrlKey: false, metaKey: false, altKey: false, repeat: false, target: div }
    expect(isBookmarkShortcut({ ...base, key: 'b' })).toBe(true)
    expect(isBookmarkShortcut({ ...base, key: 'B' })).toBe(true)
    expect(isBookmarkShortcut({ ...base, key: 'n' })).toBe(false)
    expect(isBookmarkShortcut({ ...base, key: 'b', metaKey: true })).toBe(false)
    expect(isBookmarkShortcut({ ...base, key: 'b', repeat: true })).toBe(false)
    expect(isBookmarkShortcut({ ...base, key: 'b', target: input })).toBe(false)
  })

  it('places ticks, sorts and phrases bookmarks', () => {
    expect(tickPercent(6300, 7200)).toBe(87.5)
    expect(tickPercent(9000, 7200)).toBe(100)
    expect(tickPercent(5, 0)).toBeNull()
    expect(tickPercent(5, null)).toBeNull()
    const a = makeBookmark({ id: 'a', positionSec: 10, createdAt: '2026-01-02' })
    const b = makeBookmark({ id: 'b', positionSec: 10, createdAt: '2026-01-01' })
    const c = makeBookmark({ id: 'c', positionSec: 5 })
    expect(sortBookmarks([a, b, c]).map((x) => x.id)).toEqual(['c', 'b', 'a'])
    expect(describeBookmark({ positionSec: 6300, label: '', tag: null })).toBe('1:45:00')
    expect(bookmarkQuestion({ positionSec: 60, label: '', tag: null }, '  ')).toBe('[Bookmark at 0:01:00 in the media] What is being explained at this moment?')
    expect(summarizeQuestion([c, a])).toContain('- 0:00:05\n- 0:00:10')
  })

  it('hands a moment to Media chat and reads it back once', () => {
    const onOpen = vi.fn()
    window.addEventListener(OPEN_PLUGIN_EVENT, onOpen)
    openMediaMoment({ videoKey: VIDEO_PATH, positionSec: 6300, project: 'Lecture' })
    window.removeEventListener(OPEN_PLUGIN_EVENT, onOpen)
    expect((onOpen.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: 'media-chat' })
    expect(takePendingOpen()).toEqual({ videoKey: VIDEO_PATH, positionSec: 6300, project: 'Lecture' })
    expect(takePendingOpen()).toBeNull()
    sessionStorage.setItem(PENDING_OPEN_KEY, '{bad json')
    expect(takePendingOpen()).toBeNull()
    sessionStorage.setItem(PENDING_OPEN_KEY, JSON.stringify({ videoKey: 5, positionSec: 1 }))
    expect(takePendingOpen()).toBeNull()
    sessionStorage.setItem(PENDING_OPEN_KEY, JSON.stringify({ videoKey: 'k', positionSec: -4 }))
    expect(takePendingOpen()).toEqual({ videoKey: 'k', positionSec: 0, project: undefined })
  })
})

describe('BookmarksPanel / BookmarkTimeline (#334)', () => {
  const noop = () => {}
  it('renders nothing on the timeline without a length or bookmarks', () => {
    const { container, rerender } = render(<BookmarkTimeline bookmarks={[makeBookmark()]} durationSec={null} currentTime={0} onSeek={noop} />)
    expect(container.firstChild).toBeNull()
    rerender(<BookmarkTimeline bookmarks={[]} durationSec={100} currentTime={0} onSeek={noop} />)
    expect(container.firstChild).toBeNull()
  })

  it('closes the editor when its bookmark disappears and hides Save as note without a handler', () => {
    const onEdit = vi.fn()
    const props = {
      busy: false,
      editingId: 'gone',
      onEdit,
      onAdd: noop,
      onSeek: noop,
      onUpdate: noop,
      onDelete: noop,
      onAsk: noop,
      onSummarize: noop,
      onMakeCards: noop,
    }
    render(<BookmarksPanel {...props} bookmarks={[makeBookmark({ id: 'x', label: 'kept' })]} />)
    expect(onEdit).toHaveBeenCalledWith(null)
    expect(screen.queryByRole('button', { name: 'Save as note' })).toBeNull()
    expect(screen.getByText('kept')).toBeInTheDocument()
  })
})
