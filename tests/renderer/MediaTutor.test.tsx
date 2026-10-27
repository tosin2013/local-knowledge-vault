import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MediaChatView } from '../../src/plugins/media-chat/MediaChatView'
import { isQuizRequest } from '../../src/plugins/media-chat/TutorPanel'
import { lkvMock, makeBookmark, makeIngestResult, makeMessage, makePrompt, makeSession, makeTutorQuiz, makeTutorReveal, makeVoicePack } from './lkv'

const VIDEO_PATH = '/videos/aplus-core1.mp4'

function seed() {
  const lkv = lkvMock()
  lkv.prompts.list.mockResolvedValue([makePrompt('prm_media_reader', 'Media reader'), makePrompt('prm_tutor', 'Exam tutor')])
  lkv.media.listVoicePacks.mockResolvedValue([
    makeVoicePack('prm_tutor', 'Exam tutor', { description: 'Quizzes you instead of answering' }),
  ])
  lkv.media.ingestLocal.mockResolvedValue(
    makeIngestResult({ project: 'A+ Core 1', title: 'A+ Core 1', mediaPath: VIDEO_PATH, mediaProtocolUrl: 'lkvmedia://aplus' }),
  )
  lkv.media.pickLocal.mockResolvedValue({ canceled: false, mediaPath: VIDEO_PATH, captionsPath: '/videos/aplus-core1.vtt' })
  lkv.chat.createSession.mockResolvedValue(makeSession('s_1'))
  lkv.chat.send.mockResolvedValue({ assistant: makeMessage(), messages: [], session: makeSession('s_1'), offline: false })
  return lkv
}

async function openLocal(container: HTMLElement): Promise<HTMLVideoElement> {
  fireEvent.click(screen.getByText('Local video/audio + captions'))
  const video = (await waitFor(() => {
    const el = container.querySelector('video')
    expect(el).not.toBeNull()
    return el!
  })) as HTMLVideoElement
  video.currentTime = 630
  return video
}

const panel = () => screen.getByTestId('tutor-panel')

describe('Exam tutor in Media chat (#364)', () => {
  it('quizzes at the playhead and shows no answer or citation until an attempt and a confidence pick', async () => {
    const lkv = seed()
    const { container } = render(<MediaChatView />)
    const video = await openLocal(container)
    fireEvent.click(screen.getByRole('button', { name: 'Quiz me on this part' }))
    await waitFor(() =>
      expect(lkv.media.tutorQuiz).toHaveBeenCalledWith({ videoKey: VIDEO_PATH, project: 'A+ Core 1', centerSec: 630, windowSec: 45, bookmarkId: undefined, count: 2 }),
    )
    expect(await screen.findByTestId('tutor-question')).toHaveTextContent('Which port does HTTPS use by default?')
    expect(screen.getByText(/Exam tutor: 2 questions on 0:09:45–0:11:15/)).toBeInTheDocument()

    // The guard: nothing revealed, Submit needs text, Reveal needs a confidence.
    expect(screen.queryByTestId('tutor-reveal')).toBeNull()
    expect(screen.queryByText(/Port 443/)).toBeNull()
    expect(within(panel()).queryByTestId('citation-chips')).toBeNull()
    expect(within(panel()).getByRole('button', { name: 'Submit answer' })).toBeDisabled()
    fireEvent.change(within(panel()).getByLabelText('Your answer'), { target: { value: '443' } })
    fireEvent.click(within(panel()).getByRole('button', { name: 'Submit answer' }))
    expect(screen.getByTestId('tutor-attempt')).toHaveTextContent('Your answer: 443')
    const reveal = within(panel()).getByRole('button', { name: 'Reveal answer' })
    expect(reveal).toBeDisabled()
    expect(lkv.media.tutorReveal).not.toHaveBeenCalled()
    expect(screen.queryByText(/Port 443/)).toBeNull()
    // Change my answer goes back, keeping the text.
    fireEvent.click(within(panel()).getByRole('button', { name: 'Change my answer' }))
    expect(within(panel()).getByLabelText('Your answer')).toHaveValue('443')
    fireEvent.click(within(panel()).getByRole('button', { name: 'Submit answer' }))
    fireEvent.click(within(panel()).getByRole('button', { name: 'High' }))
    fireEvent.click(within(panel()).getByRole('button', { name: 'Reveal answer' }))
    await waitFor(() =>
      expect(lkv.media.tutorReveal).toHaveBeenCalledWith({ questionId: 'tq_1', attempt: '443', dontKnow: false, justShowMe: false, confidence: 'high' }),
    )
    const shown = await screen.findByTestId('tutor-reveal')
    expect(within(shown).getByTestId('tutor-grade')).toHaveTextContent('Got it')
    expect(within(shown).getByText('High confidence')).toBeInTheDocument()
    expect(within(shown).getByTestId('tutor-answer')).toHaveTextContent('Answer: Port 443')
    expect(within(shown).getByText('“HTTPS uses port 443 by default.”')).toBeInTheDocument()
    expect(within(shown).getByText(/10:00–10:30/)).toBeInTheDocument()
    fireEvent.click(within(shown).getByRole('button', { name: 'Rewatch 0:10:00' }))
    expect(video.currentTime).toBe(600)
  })

  it('asks why after a right answer and checks the sentence', async () => {
    const lkv = seed()
    const { container } = render(<MediaChatView />)
    await openLocal(container)
    fireEvent.click(screen.getByRole('button', { name: 'Quiz me on this part' }))
    await screen.findByTestId('tutor-question')
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'port 443' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    const why = await screen.findByTestId('tutor-why')
    expect(within(why).getByText('Why is that? One sentence.')).toBeInTheDocument()
    expect(within(why).getByRole('button', { name: 'Check' })).toBeDisabled()
    fireEvent.change(within(why).getByLabelText('Why is that?'), { target: { value: 'HTTPS is the secure web protocol.' } })
    fireEvent.click(within(why).getByRole('button', { name: 'Check' }))
    await waitFor(() => expect(lkv.media.tutorWhy).toHaveBeenCalledWith({ questionId: 'tq_1', why: 'HTTPS is the secure web protocol.' }))
    expect(await screen.findByTestId('tutor-why-verdict')).toHaveTextContent('Supported')
    expect(screen.queryByTestId('tutor-practice')).toBeNull()
    // On to question 2, then finish with a score.
    fireEvent.click(screen.getByRole('button', { name: 'Next question' }))
    expect(screen.getByTestId('tutor-question')).toHaveTextContent('What does DHCP hand out to clients?')
    expect(screen.getByText('Exam tutor · question 2 of 2')).toBeInTheDocument()
    lkv.media.tutorReveal.mockResolvedValueOnce(makeTutorReveal({ questionId: 'tq_2', grade: 'partial', askWhy: true }))
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'addresses' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Low' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    expect(await screen.findByTestId('tutor-score')).toHaveTextContent('Done: 1 got it · 1 partly · 0 missed')
    expect(screen.getByTestId('tutor-grade')).toHaveTextContent('Partly')
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    expect(screen.queryByTestId('tutor-panel')).toBeNull()
  })

  it("I don't know counts as an attempt; a miss offers a Confused bookmark and a Study card", async () => {
    const lkv = seed()
    lkv.media.tutorReveal.mockResolvedValue(
      makeTutorReveal({ grade: 'missed', askWhy: false, offerPractice: true, feedback: 'No problem.', examNote: 'Your exam is in 10 days (2026-11-03). Make this a Study card so it comes back before then.' }),
    )
    const { container } = render(<MediaChatView />)
    await openLocal(container)
    fireEvent.click(screen.getByRole('button', { name: 'Quiz me on this part' }))
    await screen.findByTestId('tutor-question')
    fireEvent.click(screen.getByRole('button', { name: 'I don’t know' }))
    expect(screen.getByTestId('tutor-attempt')).toHaveTextContent('I don’t know')
    expect(screen.getByRole('button', { name: 'Reveal answer' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Change my answer' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Low' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    await waitFor(() => expect(lkv.media.tutorReveal).toHaveBeenCalledWith(expect.objectContaining({ dontKnow: true, attempt: undefined, confidence: 'low' })))
    expect(await screen.findByTestId('tutor-grade')).toHaveTextContent('Missed')
    expect(screen.queryByTestId('tutor-why')).toBeNull()
    expect(screen.getByTestId('tutor-exam-note')).toHaveTextContent(/in 10 days/)

    const practice = screen.getByTestId('tutor-practice')
    fireEvent.click(within(practice).getByRole('button', { name: 'Bookmark as Confused' }))
    await waitFor(() => expect(lkv.media.tutorPractice).toHaveBeenCalledWith({ questionId: 'tq_1', makeCard: false, videoTitle: 'A+ Core 1', sourceType: 'local' }))
    expect(await screen.findByTestId('tutor-practice-status')).toHaveTextContent('Bookmarked 0:10:00 as Confused.')
    // The new bookmark shows in the panel right away.
    expect(await screen.findByTestId('bookmark-row')).toHaveTextContent('Confused')
    expect(within(practice).getByRole('button', { name: 'Bookmark as Confused' })).toBeDisabled()

    lkv.media.tutorPractice.mockResolvedValueOnce({
      bookmark: makeBookmark({ id: 'bmk_t', tag: 'Confused', positionSec: 600, cardId: 'crd_9' }),
      bookmarkCreated: false,
      cardId: 'crd_9',
      cardCreated: true,
    })
    fireEvent.click(within(practice).getByRole('button', { name: 'Make a Study card' }))
    await waitFor(() => expect(lkv.media.tutorPractice).toHaveBeenLastCalledWith(expect.objectContaining({ makeCard: true })))
    expect(await screen.findByText('Study card made from a Confused bookmark at 0:10:00.')).toBeInTheDocument()
    expect(within(practice).getByRole('button', { name: 'Make a Study card' })).toBeDisabled()
  })

  it('reports an existing card and an existing bookmark plainly', async () => {
    const lkv = seed()
    lkv.media.tutorReveal.mockResolvedValue(makeTutorReveal({ grade: 'missed', askWhy: false, offerPractice: true }))
    const { container } = render(<MediaChatView />)
    await openLocal(container)
    fireEvent.click(screen.getByRole('button', { name: 'Quiz me on this part' }))
    await screen.findByTestId('tutor-question')
    fireEvent.click(screen.getByRole('button', { name: 'I don’t know' }))
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    await screen.findByTestId('tutor-practice')
    lkv.media.tutorPractice.mockResolvedValueOnce({ bookmark: makeBookmark({ id: 'bmk_x', tag: 'Confused', positionSec: 600 }), bookmarkCreated: false, cardId: 'crd_1', cardCreated: false })
    fireEvent.click(screen.getByRole('button', { name: 'Make a Study card' }))
    expect(await screen.findByText('This moment already has a Study card (0:10:00).')).toBeInTheDocument()
  })

  it('hints come in steps (nudge → key term → rewatch) and "Just show me" is an explicit step', async () => {
    const lkv = seed()
    const { container } = render(<MediaChatView />)
    const video = await openLocal(container)
    fireEvent.click(screen.getByRole('button', { name: 'Quiz me on this part' }))
    await screen.findByTestId('tutor-question')
    fireEvent.click(screen.getByRole('button', { name: 'Hint (1 of 3)' }))
    expect(await screen.findByText('Hint 1: hint 1')).toBeInTheDocument()
    expect(lkv.media.tutorHint).toHaveBeenLastCalledWith({ questionId: 'tq_1', level: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Hint (2 of 3)' }))
    expect(await screen.findByText('Hint 2: hint 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hint (3 of 3)' }))
    expect(await screen.findByText(/Hint 3: hint 3/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No more hints' })).toBeDisabled()
    fireEvent.click(within(screen.getByTestId('tutor-hints')).getByRole('button', { name: 'Rewatch 0:10:00' }))
    expect(video.currentTime).toBe(600)
    // Still no answer after every hint.
    expect(lkv.media.tutorReveal).not.toHaveBeenCalled()
    expect(screen.queryByTestId('tutor-reveal')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Just show me' }))
    expect(screen.getByTestId('tutor-attempt')).toHaveTextContent('(you asked to see the answer)')
    expect(screen.getByRole('button', { name: 'Reveal answer' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Low' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    await waitFor(() => expect(lkv.media.tutorReveal).toHaveBeenCalledWith(expect.objectContaining({ justShowMe: true, dontKnow: false })))
  })

  it('shows an objective tag only when the question carries a cited objectives note', async () => {
    const lkv = seed()
    lkv.media.tutorQuiz.mockResolvedValueOnce(
      makeTutorQuiz({
        questions: [
          {
            id: 'tq_1',
            quizId: 'tqz_1',
            text: 'Which port does HTTPS use by default?',
            index: 0,
            total: 2,
            kind: 'generated',
            objective: { label: '2.1 Compare and contrast TCP and UDP ports', itemId: 'itm_obj', title: 'A+ 220-1201 exam objectives' },
          },
          { id: 'tq_2', quizId: 'tqz_1', text: 'Fill the gap: DNS _____ names.', index: 1, total: 2, kind: 'cloze', objective: null },
        ],
        notice: 'AI offline: these fill-the-gap questions were made from the transcript without a model.',
      }),
    )
    const { container } = render(<MediaChatView />)
    await openLocal(container)
    fireEvent.click(screen.getByRole('button', { name: 'Quiz me on this part' }))
    const tag = await screen.findByTestId('tutor-objective')
    expect(tag).toHaveTextContent('Objective 2.1 Compare and contrast TCP and UDP ports')
    expect(tag).toHaveAttribute('title', 'From your note “A+ 220-1201 exam objectives”')
    expect(screen.getByText(/AI offline/)).toBeInTheDocument()
    fireEvent.click(tag)
    await waitFor(() => expect(lkv.items.get).toHaveBeenCalledWith('itm_obj'))
    fireEvent.click(screen.getByRole('button', { name: 'I don’t know' }))
    fireEvent.click(screen.getByRole('button', { name: 'Low' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Next question' }))
    expect(screen.queryByTestId('tutor-objective')).toBeNull()
  })

  it('quizzes a bookmark, and works in fullscreen with the same player', async () => {
    const lkv = seed()
    lkv.media.listBookmarks.mockResolvedValue([makeBookmark({ id: 'bmk_1', videoKey: VIDEO_PATH, positionSec: 2410, label: 'printers' })])
    lkv.media.tutorQuiz.mockResolvedValue(makeTutorQuiz({ bookmarkId: 'bmk_1', centerSec: 2410, windowStartSec: 2365, windowEndSec: 2455 }))
    const { container } = render(<MediaChatView />)
    const video = await openLocal(container)
    fireEvent.click(screen.getByLabelText('Enter fullscreen'))
    await screen.findByLabelText('Exit fullscreen')
    fireEvent.click(await screen.findByRole('button', { name: 'Quiz me on the bookmark at 0:40:10' }))
    await waitFor(() => expect(lkv.media.tutorQuiz).toHaveBeenCalledWith(expect.objectContaining({ bookmarkId: 'bmk_1', centerSec: 2410 })))
    expect(await screen.findByTestId('tutor-panel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quiz window starts at 0:39:25' })).toHaveTextContent('Bookmark 0:40:10')
    expect(screen.getByLabelText('Exit fullscreen')).toBeInTheDocument()
    expect(container.querySelector('video')).toBe(video)
    fireEvent.click(screen.getByRole('button', { name: 'Quiz window starts at 0:39:25' }))
    expect(video.currentTime).toBe(2365)
    fireEvent.click(screen.getByRole('button', { name: 'End quiz' }))
    expect(screen.queryByTestId('tutor-panel')).toBeNull()
    // The playhead quiz from fullscreen too.
    fireEvent.click(screen.getByRole('button', { name: 'Quiz me on this part' }))
    expect(await screen.findByTestId('tutor-panel')).toBeInTheDocument()
    expect(container.querySelector('video')).toBe(video)
  })

  it('"quiz me" typed in Ask starts the quiz instead of a chat turn; the tutor voice says how it works', async () => {
    const lkv = seed()
    const { container } = render(<MediaChatView />)
    await openLocal(container)
    fireEvent.click(await screen.findByText('Exam tutor'))
    expect(await screen.findByText(/Exam tutor quizzes you instead of answering/)).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Ask about this media…'), { target: { value: 'Quiz me on this' } })
    fireEvent.click(screen.getByLabelText('Send'))
    await waitFor(() => expect(lkv.media.tutorQuiz).toHaveBeenCalled())
    expect(lkv.chat.send).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('Ask about this media…')).toHaveValue('')
  })

  it('shows quiz and reveal errors', async () => {
    const lkv = seed()
    lkv.media.tutorQuiz.mockRejectedValueOnce(new Error('The transcript has nothing around 10:30, so there is nothing to quiz you on here.'))
    const { container } = render(<MediaChatView />)
    await openLocal(container)
    fireEvent.click(screen.getByRole('button', { name: 'Quiz me on this part' }))
    expect(await screen.findByText(/nothing to quiz you on here/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Quiz me on this part' }))
    await screen.findByTestId('tutor-question')
    lkv.media.tutorHint.mockRejectedValueOnce(new Error('hint failed'))
    fireEvent.click(screen.getByRole('button', { name: 'Hint (1 of 3)' }))
    expect(await within(panel()).findByText('hint failed')).toBeInTheDocument()
    lkv.media.tutorReveal.mockRejectedValueOnce('reveal failed')
    fireEvent.click(screen.getByRole('button', { name: 'I don’t know' }))
    fireEvent.click(screen.getByRole('button', { name: 'Low' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    expect(await within(panel()).findByText('reveal failed')).toBeInTheDocument()
    expect(screen.queryByTestId('tutor-reveal')).toBeNull()
  })

  it('recognises "quiz me" requests', () => {
    expect(isQuizRequest('quiz me')).toBe(true)
    expect(isQuizRequest('  Quiz me on ports')).toBe(true)
    expect(isQuizRequest('can you quiz me')).toBe(false)
    expect(isQuizRequest('quizzes')).toBe(false)
    expect(isQuizRequest(undefined as unknown as string)).toBe(false)
  })
})
