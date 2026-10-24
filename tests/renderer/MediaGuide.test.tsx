import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { GuidePanel, type GuidePanelProps } from '../../src/plugins/media-chat/GuidePanel'
import { MediaChatView } from '../../src/plugins/media-chat/MediaChatView'
import { checkpointState, isCheckpointShortcut, nextCheckpoint } from '../../src/plugins/media-chat/guide'
import type { GuideEntry } from '../../electron/types'
import { lkvMock, makeBookmark, makeGuide, makeGuideCheck, makeIngestResult, makeSession, makeMessage } from './lkv'

const KEY = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

function entry(overrides: Partial<GuideEntry> = {}): GuideEntry {
  return {
    id: 'gen_1',
    section: 'summary',
    startSec: 0,
    endSec: 600,
    term: null,
    text: 'My summary.',
    aiDraft: false,
    confirmed: true,
    check: null,
    itemRef: null,
    bookmarkId: null,
    createdAt: '2026-10-24T00:00:00.000Z',
    ...overrides,
  }
}

function setup(props: Partial<GuidePanelProps> = {}) {
  const lkv = lkvMock()
  const onSeek = vi.fn()
  const onPause = vi.fn()
  const onOpenNote = vi.fn()
  const onSelectCitation = vi.fn()
  const base: GuidePanelProps = {
    videoKey: KEY,
    project: 'A+',
    videoTitle: 'A+ Core 1',
    sourceType: 'youtube',
    currentTime: 30,
    durationSec: 3600,
    readTime: () => 30,
    onSeek,
    onPause,
    onSelectCitation,
    onOpenNote,
    ...props,
  }
  const utils = render(<GuidePanel {...base} />)
  const rerender = (p: Partial<GuidePanelProps>) => utils.rerender(<GuidePanel {...base} {...p} />)
  return { ...utils, lkv, onSeek, onPause, onOpenNote, onSelectCitation, rerender }
}

async function started(lkv: ReturnType<typeof lkvMock>, guide = makeGuide()) {
  lkv.media.guideList.mockResolvedValue([guide])
}

describe('checkpoint helpers (#365)', () => {
  it('every N minutes, at chapters when the video has them, after a snooze, and off', () => {
    const base = { checkpointMin: 10, checkpointsOff: false, snoozedUntilSec: null }
    expect(nextCheckpoint({ ...base, anchorSec: 0 })).toEqual({ sec: 600, chapter: null })
    expect(nextCheckpoint({ ...base, anchorSec: 600 })?.sec).toBe(1200)
    const chapters = [
      { startSec: 0, endSec: 30, title: 'Intro' },
      { startSec: 30, endSec: 400, title: 'Exam Objective 1.1' },
      { startSec: 400, endSec: 900, title: 'Exam Objective 1.2' },
    ]
    expect(nextCheckpoint({ ...base, anchorSec: 0, chapters })).toEqual({ sec: 400, chapter: 'Exam Objective 1.1' })
    expect(nextCheckpoint({ ...base, anchorSec: 400, chapters })).toEqual({ sec: 900, chapter: 'Exam Objective 1.2' })
    expect(nextCheckpoint({ ...base, anchorSec: 900, chapters })).toBeNull()
    expect(nextCheckpoint({ ...base, anchorSec: 0, snoozedUntilSec: 700 })).toEqual({ sec: 700, chapter: null })
    expect(nextCheckpoint({ ...base, checkpointsOff: true, anchorSec: 0 })).toBeNull()
    expect(nextCheckpoint({ ...base, anchorSec: 3500, durationSec: 3600 })).toBeNull()
  })

  it('playback crossing a checkpoint is due; a seek far past it is a jump', () => {
    expect(checkpointState(10, null)).toBe('none')
    expect(checkpointState(599, { sec: 600, chapter: null })).toBe('ahead')
    expect(checkpointState(601, { sec: 600, chapter: null })).toBe('due')
    expect(checkpointState(900, { sec: 600, chapter: null })).toBe('jumped')
  })

  it('G is the checkpoint key, never while typing', () => {
    const k = (key: string, extra: Partial<KeyboardEvent> = {}) =>
      ({ key, ctrlKey: false, metaKey: false, altKey: false, repeat: false, target: document.body, ...extra }) as KeyboardEvent
    expect(isCheckpointShortcut(k('g'))).toBe(true)
    expect(isCheckpointShortcut(k('G'))).toBe(true)
    expect(isCheckpointShortcut(k('b'))).toBe(false)
    expect(isCheckpointShortcut(k('g', { ctrlKey: true }))).toBe(false)
    expect(isCheckpointShortcut(k('g', { target: document.createElement('textarea') }))).toBe(false)
  })
})

describe('Study guide panel (#365)', () => {
  it('starts a study guide or research notes for the video', async () => {
    const { lkv } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Start study guide' }))
    await waitFor(() => expect(lkv.media.guideStart).toHaveBeenCalledWith(expect.objectContaining({ videoKey: KEY, project: 'A+', mode: 'study' })))
    expect(await screen.findByText('Study guide: A+ Core 1')).toBeInTheDocument()
    expect(screen.getByTestId('guide-info')).toHaveTextContent(/Vault checks it against the transcript/)
    expect(screen.getByTestId('guide-next')).toHaveTextContent('Next checkpoint 0:10:00')
    fireEvent.click(screen.getByRole('button', { name: 'Start research notes' }))
    expect(await screen.findByText('Research notes: A+ Core 1')).toBeInTheDocument()
    expect(screen.getByTestId('guide-research-form')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Study guide' }))
    expect(await screen.findByTestId('guide-term-form')).toBeInTheDocument()
  })

  it('shows start errors', async () => {
    const { lkv } = setup()
    lkv.media.guideStart.mockRejectedValueOnce(new Error("Error invoking remote method 'media:guideStart': Error: Open a media project before starting a study guide."))
    fireEvent.click(screen.getByRole('button', { name: 'Start study guide' }))
    expect(await screen.findByText('Open a media project before starting a study guide.')).toBeInTheDocument()
  })

  it('a checkpoint pauses gently when playback crosses it; you write, Vault checks; you choose what goes in', async () => {
    const lkv = lkvMock()
    await started(lkv)
    const { onPause, rerender, onSeek } = setup({ currentTime: 590 })
    await screen.findByText('Study guide: A+ Core 1')
    expect(screen.queryByTestId('guide-checkpoint')).toBeNull()
    rerender({ currentTime: 601 })
    const cp = await screen.findByTestId('guide-checkpoint')
    expect(onPause).toHaveBeenCalled()
    expect(cp).toHaveTextContent('Checkpoint 0:00:00–0:10:00')
    expect(within(cp).getByRole('button', { name: 'Check my summary' })).toBeDisabled()
    fireEvent.change(within(cp).getByLabelText('Your summary'), { target: { value: 'DHCP hands out IPs. DNS uses port 80.' } })
    fireEvent.click(within(cp).getByRole('button', { name: 'Check my summary' }))
    await waitFor(() => expect(lkv.media.guideCheckSummary).toHaveBeenCalledWith({ guideId: 'gde_1', startSec: 0, endSec: 600, text: 'DHCP hands out IPs. DNS uses port 80.' }))
    expect(await screen.findAllByTestId('guide-covered')).toHaveLength(1)
    expect(screen.getAllByTestId('guide-gap')).toHaveLength(2)
    expect(screen.getByTestId('guide-unsupported')).toHaveTextContent('“DNS uses port 80”')
    fireEvent.click(screen.getByRole('button', { name: 'Rewatch 0:10:00' }))
    expect(onSeek).toHaveBeenCalledWith(600)
    // Untick the second gap: only the first goes in.
    fireEvent.click(screen.getByLabelText('Keep: What does DNS translate?'))
    fireEvent.click(screen.getByRole('button', { name: 'Save to guide' }))
    await waitFor(() =>
      expect(lkv.media.guideSaveCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({ guideId: 'gde_1', startSec: 0, endSec: 600, text: 'DHCP hands out IPs. DNS uses port 80.', gapIndexes: [0] }),
      ),
    )
    await waitFor(() => expect(screen.queryByTestId('guide-checkpoint')).toBeNull())
    expect(screen.getByTestId('guide-info')).toHaveTextContent('Saved 0:00:00–0:10:00')
  })

  it('a seek far past a checkpoint does not prompt; checkpoints can be skipped, snoozed and turned off', async () => {
    const lkv = lkvMock()
    await started(lkv)
    const { rerender } = setup({ currentTime: 30, readTime: () => 1300 })
    await screen.findByText('Study guide: A+ Core 1')
    rerender({ currentTime: 1300 })
    await waitFor(() => expect(screen.getByTestId('guide-next')).toHaveTextContent('Next checkpoint 0:31:40'))
    expect(screen.queryByTestId('guide-checkpoint')).toBeNull()
    // G opens one at the playhead.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }))
    })
    expect(await screen.findByTestId('guide-checkpoint')).toHaveTextContent('Checkpoint 0:11:40–0:21:40')
    fireEvent.click(within(screen.getByTestId('guide-checkpoint')).getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(lkv.media.guideSettings).toHaveBeenCalledWith({ guideId: 'gde_1', lastCheckpointSec: 1300 }))
    fireEvent.click(screen.getByRole('button', { name: 'Snooze 5 min' }))
    await waitFor(() => expect(lkv.media.guideSettings).toHaveBeenCalledWith({ guideId: 'gde_1', snoozedUntilSec: 1600 }))
    expect(await screen.findByText(/snoozed for 5 minutes/)).toBeInTheDocument()
    lkv.media.guideSettings.mockResolvedValueOnce(makeGuide({ checkpointsOff: true }))
    fireEvent.mouseDown(screen.getByLabelText('Checkpoints'))
    fireEvent.click(await screen.findByRole('option', { name: 'Off' }))
    await waitFor(() => expect(lkv.media.guideSettings).toHaveBeenCalledWith({ guideId: 'gde_1', checkpointsOff: true }))
    expect(await screen.findByText(/Checkpoints are off — press G/)).toBeInTheDocument()
  })

  it('checkpoints follow chapters and show which one ends', async () => {
    const lkv = lkvMock()
    await started(lkv, makeGuide({ chapters: [{ startSec: 0, endSec: 400, title: 'Exam Objective 1.1' }, { startSec: 400, endSec: 900, title: 'Exam Objective 1.2' }] }))
    setup()
    expect(await screen.findByTestId('guide-next')).toHaveTextContent('Next checkpoint 0:06:40 · end of “Exam Objective 1.1”')
  })

  it('save without checking, skip-free; a check with nothing to flag; edit summary goes back', async () => {
    const lkv = lkvMock()
    await started(lkv)
    setup()
    await screen.findByText('Study guide: A+ Core 1')
    fireEvent.click(screen.getByRole('button', { name: 'Checkpoint now (G)' }))
    const cp = await screen.findByTestId('guide-checkpoint')
    fireEvent.change(within(cp).getByLabelText('Your summary'), { target: { value: 'Mine' } })
    lkv.media.guideCheckSummary.mockResolvedValueOnce(makeGuideCheck({ covered: [], gaps: [], unsupported: [], citations: [], notice: 'No model is available, so Vault compared words with the transcript instead.' }))
    fireEvent.click(within(cp).getByRole('button', { name: 'Check my summary' }))
    expect(await screen.findByText(/No model is available/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit summary' }))
    fireEvent.click(within(cp).getByRole('button', { name: 'Save without checking' }))
    await waitFor(() => expect(lkv.media.guideSaveCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ text: 'Mine', check: null, gapIndexes: [] })))
  })

  it('ai-draft only on request, and it must be rewritten (or summarised in my words) to confirm', async () => {
    const lkv = lkvMock()
    await started(lkv)
    const draftText = '- DHCP hands out IP addresses [itm_t1]'
    const drafted = makeGuide({ hasUnconfirmedDraft: true, entries: [entry({ id: 'gen_d', aiDraft: true, confirmed: false, text: draftText })] })
    lkv.media.guideDraft.mockResolvedValueOnce(drafted)
    setup()
    await screen.findByText('Study guide: A+ Core 1')
    expect(screen.queryByTestId('guide-draft')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Checkpoint now (G)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Draft it for me' }))
    const box = await screen.findByTestId('guide-draft')
    expect(box).toHaveTextContent('ai-draft — rewrite to confirm')
    expect(screen.getByTestId('guide-ai-draft')).toHaveTextContent('ai-draft')
    // Confirming unchanged is refused by main and the reason is shown.
    lkv.media.guideConfirm.mockRejectedValueOnce(new Error('The text is unchanged — rewrite it, or add a one-line summary in your own words.'))
    fireEvent.click(within(box).getByRole('button', { name: 'Confirm rewrite' }))
    await waitFor(() => expect(lkv.media.guideConfirm).toHaveBeenCalledWith({ entryId: 'gen_d', text: draftText }))
    expect(await screen.findByText(/The text is unchanged/)).toBeInTheDocument()
    expect(within(box).getByRole('button', { name: 'Confirm with my line' })).toBeDisabled()
    fireEvent.change(within(box).getByLabelText('One line in your own words'), { target: { value: 'Clients get addresses automatically' } })
    lkv.media.guideConfirm.mockResolvedValueOnce(makeGuide({ entries: [entry({ id: 'gen_d', aiDraft: true, confirmed: true, text: '**In my words:** Clients get addresses automatically' })] }))
    fireEvent.click(within(box).getByRole('button', { name: 'Confirm with my line' }))
    await waitFor(() => expect(lkv.media.guideConfirm).toHaveBeenLastCalledWith({ entryId: 'gen_d', ownLine: 'Clients get addresses automatically' }))
    await waitFor(() => expect(screen.queryByTestId('guide-draft')).toBeNull())
    expect(screen.queryByTestId('guide-ai-draft')).toBeNull()
    expect(screen.getByTestId('guide-entry')).toHaveTextContent('confirmed draft')
  })

  it('a rewrite confirms; a draft can be discarded', async () => {
    const lkv = lkvMock()
    await started(lkv, makeGuide({ hasUnconfirmedDraft: true, entries: [entry({ id: 'gen_d', aiDraft: true, confirmed: false, text: 'draft' })] }))
    setup()
    const box = await screen.findByTestId('guide-draft')
    fireEvent.change(within(box).getByLabelText('Rewrite the draft'), { target: { value: 'My rewrite' } })
    fireEvent.click(within(box).getByRole('button', { name: 'Confirm rewrite' }))
    await waitFor(() => expect(lkv.media.guideConfirm).toHaveBeenCalledWith({ entryId: 'gen_d', text: 'My rewrite' }))
    expect(await screen.findByText('Confirmed — it’s your note now.')).toBeInTheDocument()
  })

  it('discard removes a draft', async () => {
    const lkv = lkvMock()
    await started(lkv, makeGuide({ hasUnconfirmedDraft: true, entries: [entry({ id: 'gen_d', aiDraft: true, confirmed: false, text: 'draft' })] }))
    setup()
    const box = await screen.findByTestId('guide-draft')
    fireEvent.click(within(box).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(lkv.media.guideDeleteEntry).toHaveBeenCalledWith('gen_d'))
  })

  it('key terms are checked against the transcript at the playhead', async () => {
    const lkv = lkvMock()
    await started(lkv)
    lkv.media.guideAdd.mockResolvedValueOnce(
      makeGuide({
        entries: [
          entry({
            id: 'gen_t',
            section: 'term',
            term: 'DHCP',
            startSec: 570,
            text: 'gives out IP addresses',
            check: { verdict: 'supported', note: 'The transcript says so.', sec: 570, citations: [{ id: 'itm_t1', title: '09:30', project: 'A+' }] },
          }),
          entry({ id: 'gen_x', section: 'term', term: 'Recursion', startSec: null, text: 'x', check: { verdict: 'not-found', note: 'The transcript doesn’t mention “Recursion”.', sec: null, citations: [] } }),
        ],
      }),
    )
    const { onSelectCitation } = setup({ readTime: () => 575 })
    await screen.findByText('Study guide: A+ Core 1')
    const form = screen.getByTestId('guide-term-form')
    fireEvent.change(within(form).getByLabelText('Key term'), { target: { value: 'DHCP' } })
    fireEvent.change(within(form).getByLabelText('Definition in your own words'), { target: { value: 'gives out IP addresses' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Check & add' }))
    await waitFor(() => expect(lkv.media.guideAdd).toHaveBeenCalledWith({ guideId: 'gde_1', sec: 575, section: 'term', term: 'DHCP', text: 'gives out IP addresses' }))
    const verdicts = await screen.findAllByTestId('guide-verdict')
    expect(verdicts[0]).toHaveTextContent('Transcript supports this')
    expect(verdicts[1]).toHaveTextContent('Not in the transcript')
    expect(within(form).getByLabelText('Key term')).toHaveValue('')
    fireEvent.click(screen.getByText('[1] 09:30'))
    expect(onSelectCitation).toHaveBeenCalledWith('itm_t1')
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove Key term' })[0])
    await waitFor(() => expect(lkv.media.guideDeleteEntry).toHaveBeenCalledWith('gen_t'))
  })

  it('research quotes must match the transcript exactly — otherwise refused, with "add as a claim"', async () => {
    const lkv = lkvMock()
    await started(lkv, makeGuide({ id: 'gde_r', mode: 'research', noteTitle: 'Research notes: L1' }))
    setup({ currentTime: 60, readTime: () => 61 })
    await screen.findByText('Research notes: L1')
    fireEvent.mouseDown(screen.getByLabelText('Add'))
    fireEvent.click(await screen.findByRole('option', { name: 'Quote' }))
    fireEvent.change(screen.getByLabelText('Research entry'), { target: { value: 'imperative knowledge is a recipe or how-to' } })
    lkv.media.guideAdd.mockRejectedValueOnce(new Error('That quote doesn’t match the transcript exactly. Fix it to match word for word, or add it as a claim instead.'))
    fireEvent.click(screen.getByRole('button', { name: 'Add at 0:01:00' }))
    await waitFor(() => expect(lkv.media.guideAdd).toHaveBeenCalledWith({ guideId: 'gde_r', sec: 61, section: 'quote', text: 'imperative knowledge is a recipe or how-to' }))
    expect(await screen.findByText(/doesn’t match the transcript exactly/)).toBeInTheDocument()
    expect(screen.getByLabelText('Research entry')).toHaveValue('imperative knowledge is a recipe or how-to')
    fireEvent.click(screen.getByRole('button', { name: 'Add as a claim' }))
    lkv.media.guideAdd.mockResolvedValueOnce(
      makeGuide({ id: 'gde_r', mode: 'research', noteTitle: 'Research notes: L1', entries: [entry({ id: 'gen_q', section: 'claim', text: 'imperative knowledge is a recipe or how-to', startSec: 60 })] }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add at 0:01:00' }))
    await waitFor(() => expect(lkv.media.guideAdd).toHaveBeenLastCalledWith(expect.objectContaining({ section: 'claim' })))
    expect(await screen.findByTestId('guide-entry')).toHaveTextContent('Claim')
  })

  it('an exact quote is shown in quotes with its timestamp', async () => {
    const lkv = lkvMock()
    await started(lkv, makeGuide({ id: 'gde_r', mode: 'research', noteTitle: 'Research notes: L1', entries: [entry({ section: 'quote', text: 'a recipe, a how-to', startSec: 60 })] }))
    setup()
    const e = await screen.findByTestId('guide-entry')
    expect(e).toHaveTextContent('“a recipe, a how-to”')
    expect(within(e).getByRole('button', { name: 'Rewatch 0:01:00' })).toBeInTheDocument()
  })

  it('connections: finds related vault notes and links one', async () => {
    const lkv = lkvMock()
    await started(lkv, makeGuide({ id: 'gde_r', mode: 'research', noteTitle: 'Research notes: L1' }))
    lkv.media.guideRelated.mockResolvedValueOnce([{ itemId: 'itm_n1', title: 'My Python types cheat sheet', snippet: 'int float', project: 'MIT' }])
    setup()
    await screen.findByText('Research notes: L1')
    fireEvent.click(screen.getByRole('button', { name: 'Find related notes in my vault' }))
    expect(await screen.findByText('My Python types cheat sheet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    await waitFor(() => expect(lkv.media.guideConnect).toHaveBeenCalledWith({ guideId: 'gde_r', itemId: 'itm_n1' }))
    await waitFor(() => expect(screen.queryByTestId('guide-related')).toBeNull())
  })

  it('no related notes says so', async () => {
    const lkv = lkvMock()
    await started(lkv, makeGuide({ id: 'gde_r', mode: 'research', noteTitle: 'Research notes: L1' }))
    setup()
    await screen.findByText('Research notes: L1')
    fireEvent.click(screen.getByRole('button', { name: 'Find related notes in my vault' }))
    expect(await screen.findByText(/No related notes found yet/)).toBeInTheDocument()
  })

  it('Review these lists bookmarks and Exam tutor misses; cards come with a review date', async () => {
    const lkv = lkvMock()
    await started(
      lkv,
      makeGuide({
        review: [
          { kind: 'tutor-miss', sec: 600, label: 'Which port does HTTPS use?', tag: null, confidentWrong: true, refId: 'tq_1' },
          { kind: 'bookmark', sec: 750, label: 'Rebinding?', tag: 'Confused', confidentWrong: false, refId: 'bmk_1' },
        ],
      }),
    )
    const { onSeek, onOpenNote } = setup()
    const review = await screen.findByTestId('guide-review')
    expect(review).toHaveTextContent('Exam tutor (confident but wrong): Which port does HTTPS use?')
    expect(review).toHaveTextContent('Rebinding?')
    expect(within(review).getByText('Confused')).toBeInTheDocument()
    fireEvent.click(within(review).getByRole('button', { name: 'Rewatch 0:12:30' }))
    expect(onSeek).toHaveBeenCalledWith(750)
    fireEvent.click(screen.getByRole('button', { name: /Make Study cards/ }))
    expect(await screen.findByTestId('guide-cards')).toHaveTextContent('Made 2 cards. No exam date set — review these tomorrow')
    lkv.media.guideCards.mockResolvedValueOnce({ created: 0, existing: 2, reviewDate: '2026-11-02', reviewNote: 'Your exam is in 27 days (2026-11-20) — first review on 2026-11-02.' })
    fireEvent.click(screen.getByRole('button', { name: /Make Study cards/ }))
    await waitFor(() => expect(screen.getByTestId('guide-cards')).toHaveTextContent('No new cards (2 already made). Your exam is in 27 days'))
    fireEvent.click(screen.getByRole('button', { name: 'Open note' }))
    expect(onOpenNote).toHaveBeenCalledWith('itm_guide')
  })

  it('makes-cards errors are shown', async () => {
    const lkv = lkvMock()
    await started(lkv)
    lkv.media.guideCards.mockRejectedValueOnce(new Error('Add a key term or keep a gap first — cards are made from those.'))
    setup()
    await screen.findByText('Study guide: A+ Core 1')
    fireEvent.click(screen.getByRole('button', { name: /Make Study cards/ }))
    expect(await screen.findByTestId('guide-error')).toHaveTextContent('Add a key term or keep a gap first')
  })

  it('reloads for another video', async () => {
    const lkv = lkvMock()
    await started(lkv)
    const { rerender } = setup()
    await screen.findByText('Study guide: A+ Core 1')
    lkv.media.guideList.mockResolvedValueOnce([makeGuide({ id: 'gde_r', mode: 'research', noteTitle: 'Research notes: other', videoKey: 'k2' })])
    rerender({ videoKey: 'k2' })
    await waitFor(() => expect(lkv.media.guideList).toHaveBeenLastCalledWith('k2'))
    expect(await screen.findByText('Research notes: other')).toBeInTheDocument()
  })
})

describe('Study guide inside Media chat (#365)', () => {
  it('is in the player column and stays there in fullscreen; G opens a checkpoint and pauses', async () => {
    const lkv = lkvMock()
    lkv.media.ingestLocal.mockResolvedValue(makeIngestResult({ project: 'MIT', title: 'Lecture 1', mediaPath: '/videos/l1.mp4', mediaProtocolUrl: 'lkvmedia://l1' }))
    lkv.media.pickLocal.mockResolvedValue({ canceled: false, mediaPath: '/videos/l1.mp4', captionsPath: '/videos/l1.vtt' })
    lkv.media.listBookmarks.mockResolvedValue([makeBookmark({ videoKey: '/videos/l1.mp4' })])
    lkv.chat.createSession.mockResolvedValue(makeSession('s_1'))
    lkv.chat.send.mockResolvedValue({ assistant: makeMessage(), messages: [], session: makeSession('s_1'), offline: false })
    lkv.media.guideList.mockResolvedValue([makeGuide({ videoKey: '/videos/l1.mp4', noteTitle: 'Study guide: Lecture 1' })])
    const { container } = render(<MediaChatView />)
    fireEvent.click(screen.getByText('Local video/audio + captions'))
    const video = (await waitFor(() => {
      const el = container.querySelector('video')
      expect(el).not.toBeNull()
      return el!
    })) as HTMLVideoElement
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => {})
    await waitFor(() => expect(lkv.media.guideList).toHaveBeenCalledWith('/videos/l1.mp4'))
    expect(await screen.findByText('Study guide: Lecture 1')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Enter fullscreen'))
    expect(container.querySelectorAll('video')).toHaveLength(1)
    expect(container.querySelector('video')).toBe(video)
    expect(screen.getByTestId('guide-panel')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open note' })).toBeNull()
    video.currentTime = 125
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'G' }))
    })
    expect(await screen.findByTestId('guide-checkpoint')).toHaveTextContent('0:02:05')
    expect(pause).toHaveBeenCalled()
  })
})
