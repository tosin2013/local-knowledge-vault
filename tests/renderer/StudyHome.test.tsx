import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StudyHome, enrollSummary } from '../../src/features/study/StudyHome'
import { lkvMock } from './lkv'

const BIO_STATS = {
  project: 'Biology',
  examDate: '2099-06-01',
  due: 7,
  totalCards: 30,
  newCards: 12,
  liveNotes: 20,
  enrolledNotes: 14,
  lastSession: {
    reviewed: 10,
    got: 8,
    partial: 1,
    missed: 1,
    score: 0.8,
    startedAt: '2026-10-07T13:00:00.000Z',
    endedAt: '2026-10-07T13:20:00.000Z',
  },
  newPerDay: 5,
  newLeftToday: 3,
  unreachable: 0,
}

function renderHome(project = 'Biology', overrides: { onStartReview?: () => void } = {}) {
  const onProjectChange = vi.fn()
  const onStartReview = overrides.onStartReview ?? vi.fn()
  render(<StudyHome project={project} onProjectChange={onProjectChange} onStartReview={onStartReview} />)
  return { onProjectChange, onStartReview }
}

describe('StudyHome (#262)', () => {
  it('shows the project stats: exam date, days to go, due, cards and last session', async () => {
    const lkv = lkvMock()
    lkv.projects.list.mockResolvedValue([{ name: 'Biology', count: 20, examDate: '2099-06-01' }])
    lkv.projects.getSettings.mockResolvedValue({ name: 'Biology', examDate: '2099-06-01' })
    lkv.review.stats.mockResolvedValue(BIO_STATS)
    const { onStartReview } = renderHome()

    const stats = await screen.findByTestId('study-stats')
    await waitFor(() => expect(stats).toHaveTextContent('Jun 1, 2099'))
    expect(lkv.review.stats).toHaveBeenCalledWith('Biology')
    expect(screen.getByLabelText('Exam')).toHaveTextContent(/\d+ days to go/)
    expect(screen.getByLabelText('Due now')).toHaveTextContent('7')
    expect(screen.getByLabelText('Due now')).toHaveTextContent('12 new cards')
    expect(screen.getByLabelText('Cards')).toHaveTextContent('30from 14 of 20 notes')
    expect(screen.getByLabelText('Last session')).toHaveTextContent('80%')
    expect(screen.getByLabelText('Last session')).toHaveTextContent('8 of 10 recalled')

    fireEvent.click(screen.getByRole('button', { name: 'Start session (7 due)' }))
    expect(onStartReview).toHaveBeenCalled()
  })

  it('enrolls the project and reports notes → cards, skipped with reasons', async () => {
    const lkv = lkvMock()
    lkv.projects.list.mockResolvedValue([{ name: 'Biology', count: 20 }])
    lkv.review.stats.mockResolvedValue({ ...BIO_STATS, examDate: null, lastSession: null })
    lkv.review.enqueueProject.mockResolvedValue({
      project: 'Biology',
      notes: 12,
      cards: 30,
      alreadyScheduled: 5,
      skipped: [
        { itemId: 'a', title: 'Regents · p.1', reason: 'boilerplate (cover, instructions, copyright or site chrome)' },
        { itemId: 'b', title: 'Draft: ATP', reason: 'unconfirmed AI draft (confirm it in your own words first)' },
        { itemId: 'c', title: 'Regents · p.2', reason: 'boilerplate (cover, instructions, copyright or site chrome)' },
      ],
    })
    renderHome()

    fireEvent.click(await screen.findByRole('button', { name: 'Study this project' }))
    await waitFor(() => expect(lkv.review.enqueueProject).toHaveBeenCalledWith('Biology'))
    expect(await screen.findByText('12 notes → 30 cards, 3 skipped')).toBeInTheDocument()
    expect(screen.getByText('5 notes were already scheduled and left as they are.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Skipped: 2 boilerplate (cover, instructions, copyright or site chrome); 1 unconfirmed AI draft (confirm it in your own words first).',
      ),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show skipped notes' }))
    expect(await screen.findByText('Draft: ATP')).toBeVisible()
    // Stats refresh after enrolling.
    expect(lkv.review.stats.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('shows an empty state when there are no projects', async () => {
    renderHome('')
    expect(await screen.findByText(/No projects yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Study this project' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Nothing due' })).toBeDisabled()
  })

  it('asks for a project when "All projects" is selected', async () => {
    const lkv = lkvMock()
    lkv.projects.list.mockResolvedValue([{ name: 'Biology', count: 2 }])
    renderHome('')
    expect(await screen.findByText(/Pick the project for your course or exam/)).toBeInTheDocument()
    expect(lkv.review.stats).toHaveBeenCalledWith(undefined)
    expect(screen.getByRole('button', { name: 'Study this project' })).toBeDisabled()
    expect(screen.getByLabelText('Exam')).toHaveTextContent('Pick a project')
  })

  it('explains a project with no notes', async () => {
    const lkv = lkvMock()
    lkv.projects.list.mockResolvedValue([{ name: 'Empty course', count: 0 }])
    lkv.review.stats.mockResolvedValue({
      ...BIO_STATS,
      project: 'Empty course',
      examDate: null,
      due: 0,
      totalCards: 0,
      newCards: 0,
      liveNotes: 0,
      enrolledNotes: 0,
      lastSession: null,
    })
    renderHome('Empty course')
    expect(await screen.findByText(/Empty course has no notes yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Study this project' })).toBeDisabled()
  })

  it('says when nothing is due', async () => {
    const lkv = lkvMock()
    lkv.projects.list.mockResolvedValue([{ name: 'Biology', count: 20 }])
    lkv.review.stats.mockResolvedValue({ ...BIO_STATS, due: 0 })
    renderHome()
    expect(await screen.findByText(/Nothing due right now/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nothing due' })).toBeDisabled()
  })

  it('shows an error when enrolling fails', async () => {
    const lkv = lkvMock()
    lkv.projects.list.mockResolvedValue([{ name: 'Biology', count: 20 }])
    lkv.review.stats.mockResolvedValue(BIO_STATS)
    lkv.review.enqueueProject.mockRejectedValue(new Error('disk full'))
    renderHome()
    fireEvent.click(await screen.findByRole('button', { name: 'Study this project' }))
    expect(await screen.findByText('disk full')).toBeInTheDocument()
  })

  it('shows the daily new-card budget (#264)', async () => {
    const lkv = lkvMock()
    lkv.projects.list.mockResolvedValue([{ name: 'Biology', count: 20 }])
    lkv.review.stats.mockResolvedValue(BIO_STATS)
    renderHome()
    await waitFor(() => expect(screen.getByLabelText('Due now')).toHaveTextContent('incl. new: 3 of 5 today'))
    expect(screen.queryByTestId('coverage-warning')).not.toBeInTheDocument()
  })

  it('warns when cards will not be reached before the exam (#264)', async () => {
    const lkv = lkvMock()
    lkv.projects.list.mockResolvedValue([{ name: 'A+', count: 300 }])
    lkv.review.stats.mockResolvedValue({ ...BIO_STATS, project: 'A+', newPerDay: 25, unreachable: 42 })
    renderHome('A+')
    expect(await screen.findByTestId('coverage-warning')).toHaveTextContent(
      "42 cards won't be reached before your exam at 25 new cards a day.",
    )
  })

  it('formats the enroll summary', () => {
    expect(enrollSummary({ project: 'x', notes: 1, cards: 1, alreadyScheduled: 0, skipped: [] })).toBe(
      '1 note → 1 card, 0 skipped',
    )
  })
})
