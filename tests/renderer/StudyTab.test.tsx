import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { StudyTab } from '../../src/features/study/StudyTab'
import type { StudySection } from '../../src/features/study/sections'

function Harness({ initial = 'review' as StudySection }) {
  const [section, setSection] = useState<StudySection>(initial)
  return <StudyTab section={section} onSection={setSection} onOpenNote={vi.fn()} onNewDraft={vi.fn()} />
}

describe('StudyTab (#260)', () => {
  it('renders an accessible tab list with the three sections, Review first', async () => {
    render(<Harness />)
    expect(screen.getByRole('heading', { name: 'Study' })).toBeInTheDocument()
    const list = screen.getByRole('tablist', { name: 'Study sections' })
    expect(list).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Review due notes', 'Quiz me on…', 'Import practice test'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'study-tab-review')
    expect(await screen.findByText('Nothing due.')).toBeInTheDocument()
  })

  it('switches between the existing screens without a Back to Ask button', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('tab', { name: 'Quiz me on…' }))
    expect(screen.getByRole('tab', { name: 'Quiz me on…' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByLabelText('Question')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Import practice test' }))
    expect(await screen.findByText('Test to notes')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back to Ask' })).not.toBeInTheDocument()
  })

  it('opens on the section it is given', () => {
    render(<Harness initial="import" />)
    expect(screen.getByRole('tab', { name: 'Import practice test' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Test to notes')).toBeInTheDocument()
  })
})
