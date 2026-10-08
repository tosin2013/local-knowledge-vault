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
    expect(tabs.map((t) => t.textContent)).toEqual(['Home', 'Review due notes', 'Quiz me on…', 'Import practice test'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'study-tab-home')
    expect(await screen.findByTestId('study-home')).toBeInTheDocument()
  })

  it('renders Review due notes when given that section', async () => {
    render(<Harness />)
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'study-tab-review')
    expect(await screen.findByText('Nothing due.')).toBeInTheDocument()
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
      expect(window.lkv.review.listDue).toHaveBeenLastCalledWith({ limit: 50, project: 'Biology' }),
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
    expect(await screen.findByText('Test to notes')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back to Ask' })).not.toBeInTheDocument()
  })

  it('opens on the section it is given', () => {
    render(<Harness initial="import" />)
    expect(screen.getByRole('tab', { name: 'Import practice test' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Test to notes')).toBeInTheDocument()
  })
})
