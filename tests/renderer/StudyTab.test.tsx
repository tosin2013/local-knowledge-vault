import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { StudyTab } from '../../src/features/study/StudyTab'
import type { StudySection } from '../../src/features/study/sections'

function Harness({ initial = 'review' as StudySection }) {
  const [section, setSection] = useState<StudySection>(initial)
  return <StudyTab section={section} onSection={setSection} onOpenNote={vi.fn()} onNewDraft={vi.fn()} />
}

describe('StudyTab (#260)', () => {
  it('renders an accessible tab list with Study home first', async () => {
    render(<Harness initial="home" />)
    expect(screen.getByRole('heading', { name: 'Study' })).toBeInTheDocument()
    const list = screen.getByRole('tablist', { name: 'Study sections' })
    expect(list).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Home', 'Study session', 'Talk it through', 'Quiz me on…', 'Import practice test'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'study-tab-home')
    expect(await screen.findByTestId('study-home')).toBeInTheDocument()
  })

  it('renders the Study session when given that section', async () => {
    render(<Harness />)
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'study-tab-review')
    expect(await screen.findByRole('button', { name: 'Start session' })).toBeInTheDocument()
  })

  it('shares one remembered project across sections (#262)', async () => {
    window.lkv.projects.list = vi.fn().mockResolvedValue([
      { name: 'Biology', count: 3 },
      { name: 'A+', count: 5 },
    ])
    const { unmount } = render(<Harness />)
    // "All projects" shows its label instead of rendering blank.
    expect(await screen.findByRole('combobox', { name: 'Project' })).toHaveTextContent('All projects')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Project' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Biology' }))
    await waitFor(() =>
      expect(window.lkv.review.count).toHaveBeenLastCalledWith({ project: 'Biology' }),
    )

    // Quiz me on… and Import practice test start on the same project.
    fireEvent.click(screen.getByRole('tab', { name: 'Quiz me on…' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Project' })).toHaveTextContent('Biology'))
    fireEvent.click(screen.getByRole('tab', { name: 'Import practice test' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Project' })).toHaveTextContent('Biology'))
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }))
    await waitFor(() => expect(window.lkv.review.stats).toHaveBeenLastCalledWith('Biology'))

    // Leaving the Study tab (unmount) and coming back keeps the choice.
    unmount()
    render(<Harness initial="review" />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Project' })).toHaveTextContent('Biology'))
  })

  it('falls back to all projects when the remembered project is gone', async () => {
    localStorage.setItem('lkv.study.project', 'Deleted course')
    window.lkv.projects.list = vi.fn().mockResolvedValue([{ name: 'Biology', count: 3 }])
    render(<Harness />)
    await waitFor(() => expect(localStorage.getItem('lkv.study.project')).toBeNull())
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveTextContent('All projects')
  })

  it('switches between the existing screens without a Back to Ask button', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('tab', { name: 'Quiz me on…' }))
    expect(screen.getByRole('tab', { name: 'Quiz me on…' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByLabelText('Question')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Import practice test' }))
    expect(await screen.findByRole('heading', { name: 'Import practice test' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back to Ask' })).not.toBeInTheDocument()
  })

  it('opens on the section it is given', () => {
    render(<Harness initial="import" />)
    expect(screen.getByRole('tab', { name: 'Import practice test' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Import practice test' })).toBeInTheDocument()
  })

  it('Work on weak spots opens a Study session that starts itself (#420)', async () => {
    window.localStorage.setItem('lkv.study.project', 'Biology')
    window.lkv.projects.list = vi.fn().mockResolvedValue([{ name: 'Biology', count: 3 }])
    window.lkv.review.stats = vi.fn().mockResolvedValue({
      project: 'Biology',
      examDate: null,
      due: 0,
      totalCards: 2,
      newCards: 1,
      liveNotes: 2,
      enrolledNotes: 1,
      lastSession: null,
      newPerDay: 0,
      newLeftToday: 0,
      unreachable: 0,
    })
    window.lkv.review.readiness = vi.fn().mockResolvedValue({
      project: 'Biology',
      examDate: null,
      daysToExam: null,
      dueBeforeExam: 0,
      strong: [],
      shaky: [
        {
          itemId: 'itm_w',
          title: 'Krebs cycle',
          group: 'shaky',
          reasons: ['Last review: Missed'],
          cards: 1,
          lastGrade: 'again',
          lapses: 1,
          openConfidentMisses: 0,
          dueBeforeExam: 0,
          lastReviewedAt: null,
        },
      ],
      unstudied: [],
      trend: null,
      weakItemIds: ['itm_w'],
    })
    window.lkv.study.startSession = vi.fn().mockResolvedValue({
      sessionId: 'ses_weak',
      cards: [
        {
          id: 'itm_w',
          title: 'Krebs cycle',
          body: 'The Krebs cycle.',
          card_id: 'crd_w',
          chunk_index: null,
          chunk_count: 0,
          card_text: 'The Krebs cycle.',
          origin: 'note',
          question: null,
          answer: null,
          quote: null,
          due_at: '2026-11-19T00:00:00.000Z',
          interval_days: 0,
          ease: 2.5,
          reps: 1,
          lapses: 1,
          last_grade: 'again',
          last_reviewed_at: '2026-11-18T00:00:00.000Z',
        },
      ],
      itemIds: ['itm_w'],
      enrolled: 0,
    })
    window.lkv.study.cardQuestion = vi.fn().mockResolvedValue({
      cardId: 'crd_w',
      itemId: 'itm_w',
      title: 'Krebs cycle',
      project: 'Biology',
      origin: 'note',
      kind: 'explain',
      question: 'What happens in the Krebs cycle?',
      answer: 'ATP',
      quote: null,
      sectionText: 'The Krebs cycle.',
      chunkIndex: null,
      chunkCount: 0,
      citations: [],
    })
    render(<Harness initial="home" />)
    expect(await screen.findByTestId('readiness-panel')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Work on weak spots/ }))
    expect(screen.getByRole('tab', { name: 'Study session' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(window.lkv.study.startSession).toHaveBeenCalledWith(expect.objectContaining({ project: 'Biology', weakSpots: true })))
    expect(await screen.findByText('What happens in the Krebs cycle?')).toBeInTheDocument()
    window.localStorage.removeItem('lkv.study.project')
  })

})
