import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ProjectReadiness } from '../../electron/types'
import { ReadinessPanel } from '../../src/features/study/ReadinessPanel'
import { READINESS_CAPTION } from '../../src/features/study/readinessCopy'

const READY: ProjectReadiness = {
  project: 'Biology',
  examDate: '2026-11-25',
  daysToExam: 6,
  dueBeforeExam: 2,
  strong: [
    {
      itemId: 'itm_strong',
      title: 'ATP',
      group: 'strong',
      reasons: ['Last review: Got it'],
      cards: 1,
      lastGrade: 'good',
      lapses: 0,
      openConfidentMisses: 0,
      dueBeforeExam: 0,
      lastReviewedAt: '2026-11-18T00:00:00.000Z',
    },
  ],
  shaky: [
    {
      itemId: 'itm_shaky',
      title: 'Krebs cycle',
      group: 'shaky',
      reasons: ['Last review: Missed', '1 lapse'],
      cards: 1,
      lastGrade: 'again',
      lapses: 1,
      openConfidentMisses: 0,
      dueBeforeExam: 1,
      lastReviewedAt: '2026-11-18T00:00:00.000Z',
    },
  ],
  unstudied: [
    {
      itemId: 'itm_new',
      title: 'Chloroplasts',
      group: 'unstudied',
      reasons: ['Not studied yet'],
      cards: 0,
      lastGrade: null,
      lapses: 0,
      openConfidentMisses: 0,
      dueBeforeExam: 0,
      lastReviewedAt: null,
    },
  ],
  trend: { thisWeek: { got: 3, partial: 0, missed: 1 }, lastWeek: { got: 1, partial: 0, missed: 2 } },
  weakItemIds: ['itm_shaky', 'itm_new'],
}

describe('ReadinessPanel (#420)', () => {
  it('renders the counts, evidence, trend and a Work on weak spots button', () => {
    const onOpenNote = vi.fn()
    const onWork = vi.fn()
    render(<ReadinessPanel readiness={READY} onOpenNote={onOpenNote} onWorkWeakSpots={onWork} />)

    const panel = screen.getByTestId('readiness-panel')
    expect(panel).toHaveTextContent('Strong: 1 note, Shaky: 1 note, Not studied: 1 note, 6 days to exam')
    expect(screen.getByTestId('readiness-due')).toHaveTextContent('2 cards due before the exam')
    expect(screen.getByTestId('readiness-trend')).toHaveTextContent('This week: 3 got it, 1 missed')
    expect(screen.getByText(READINESS_CAPTION)).toBeInTheDocument()
    expect(panel.textContent?.toLowerCase()).not.toMatch(/you're ready|you are ready/)

    expect(screen.getByTestId('readiness-strong')).toHaveTextContent('ATP')
    expect(screen.getByTestId('readiness-strong')).toHaveTextContent('Last review: Got it')
    expect(screen.getByTestId('readiness-shaky')).toHaveTextContent('Krebs cycle')
    expect(screen.getByTestId('readiness-unstudied')).toHaveTextContent('Not studied yet')

    fireEvent.click(screen.getByRole('button', { name: 'Open Krebs cycle' }))
    expect(onOpenNote).toHaveBeenCalledWith('itm_shaky')

    fireEvent.click(screen.getByTestId('work-weak-spots'))
    expect(onWork).toHaveBeenCalled()
  })

  it('hides and shows the note lists', () => {
    render(<ReadinessPanel readiness={READY} />)
    expect(screen.getByText('Krebs cycle')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Hide notes' }))
    expect(screen.getByRole('button', { name: 'Show notes' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show notes' }))
    expect(screen.getByText('Krebs cycle')).toBeVisible()
  })

  it('disables Work on weak spots when there is nothing to work on, and renders None for empty groups', () => {
    const empty: ProjectReadiness = {
      ...READY,
      shaky: [],
      unstudied: [],
      weakItemIds: [],
      dueBeforeExam: 0,
      trend: null,
      daysToExam: null,
      examDate: null,
    }
    const onWork = vi.fn()
    render(<ReadinessPanel readiness={empty} onWorkWeakSpots={onWork} />)
    expect(screen.getByTestId('work-weak-spots')).toBeDisabled()
    expect(screen.getByTestId('readiness-shaky')).toHaveTextContent('None')
    expect(screen.getByTestId('readiness-unstudied')).toHaveTextContent('None')
    expect(screen.queryByTestId('readiness-due')).not.toBeInTheDocument()
    expect(screen.queryByTestId('readiness-trend')).not.toBeInTheDocument()
    expect(screen.queryByText('Exam today')).not.toBeInTheDocument()
  })

  it('shows a starting state and renders nothing without readiness data', () => {
    const { rerender } = render(<ReadinessPanel readiness={READY} starting onWorkWeakSpots={() => undefined} />)
    expect(screen.getByTestId('work-weak-spots')).toBeDisabled()
    expect(screen.getByTestId('work-weak-spots')).toHaveTextContent('Starting…')
    rerender(<ReadinessPanel readiness={null} />)
    expect(screen.queryByTestId('readiness-panel')).not.toBeInTheDocument()
  })
})
