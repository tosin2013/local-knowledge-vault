import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReviewView } from '../../src/features/study/ReviewView'
import { lkvMock, makeHit } from './lkv'

describe('ReviewView', () => {
  it('shows the new-card budget and the coverage warning (#264)', async () => {
    const lkv = lkvMock()
    lkv.review.stats.mockResolvedValue({
      project: null,
      examDate: null,
      due: 30,
      totalCards: 300,
      newCards: 290,
      liveNotes: 100,
      enrolledNotes: 100,
      lastSession: null,
      newPerDay: 25,
      newLeftToday: 20,
      unreachable: 40,
    })
    render(<ReviewView />)
    expect(await screen.findByTestId('new-budget')).toHaveTextContent('New cards today: 20 of 25.')
    expect(screen.getByTestId('coverage-warning')).toHaveTextContent(
      "40 cards won't be reached before your exam at 25 new cards a day.",
    )
  })

  it('shows the project exam date and starts the session in that project', async () => {
    const lkv = lkvMock()
    lkv.projects.list.mockResolvedValue([{ name: 'Biology', count: 2, examDate: '2099-06-01' }])
    lkv.projects.getSettings.mockResolvedValue({ name: 'Biology', examDate: '2099-06-01' })
    render(<ReviewView />)

    // All projects has no exam date.
    expect(await screen.findByTestId('exam-date-none')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Target exam date/i)).not.toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Project' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Biology' }))
    expect(await screen.findByText('Jun 1, 2099')).toBeInTheDocument()
    expect(lkv.projects.getSettings).toHaveBeenCalledWith('Biology')


    // The session starts in that project; the main process reads the exam date from it.
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
    await waitFor(() => expect(lkv.study.startSession).toHaveBeenCalledWith({ project: 'Biology', limit: 20 }))
  })

  it('sets the project exam date from Study', async () => {
    const lkv = lkvMock()
    lkv.projects.list.mockResolvedValue([{ name: 'Biology', count: 2 }])
    render(<ReviewView />)

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Project' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Biology' }))
    expect(await screen.findByText('No exam date for Biology')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Set exam date' }))
    fireEvent.change(screen.getByLabelText('Exam date'), { target: { value: '2099-06-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(lkv.projects.setExamDate).toHaveBeenCalledWith('Biology', '2099-06-01'))
    expect(await screen.findByText('Jun 1, 2099')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('shows a validation error from the main process', async () => {
    const lkv = lkvMock()
    lkv.projects.list.mockResolvedValue([{ name: 'Biology', count: 2, examDate: '2099-06-01' }])
    lkv.projects.getSettings.mockResolvedValue({ name: 'Biology', examDate: '2099-06-01' })
    lkv.projects.setExamDate.mockRejectedValue(new Error('2026-02-30 is not a real date'))
    render(<ReviewView />)

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Project' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Biology' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Exam date'), { target: { value: '2026-02-28' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('2026-02-30 is not a real date')).toBeInTheDocument()

    // Clear removes the date.
    lkv.projects.setExamDate.mockResolvedValue({ name: 'Biology', examDate: null })
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(lkv.projects.setExamDate).toHaveBeenLastCalledWith('Biology', null))
    expect(await screen.findByText('No exam date for Biology')).toBeInTheDocument()
  })

  it('searches notes and enqueues one for review', async () => {
    const lkv = lkvMock()
    lkv.search.query.mockResolvedValue({ hits: [makeHit('itm_9', { title: 'Cell biology' })] })
    render(<ReviewView />)

    fireEvent.change(screen.getByLabelText(/Search your notes/i), {
      target: { value: 'cell' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByText('Cell biology')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add to review' }))

    await waitFor(() =>
      expect(lkv.review.enqueue).toHaveBeenCalledWith({ itemId: 'itm_9', pairs: true }),
    )
    expect(await screen.findByText('Added “Cell biology” to Study.')).toBeInTheDocument()
  })

  it('reports how many cards a long note became', async () => {
    const lkv = lkvMock()
    lkv.search.query.mockResolvedValue({ hits: [makeHit('itm_9', { title: 'Cell biology' })] })
    lkv.review.enqueue.mockResolvedValue({ created: 4, cards: 4, alreadyEnrolled: false })
    render(<ReviewView />)

    fireEvent.change(screen.getByLabelText(/Search your notes/i), { target: { value: 'cell' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add to review' }))
    expect(await screen.findByText(/as 4 cards/)).toBeInTheDocument()
  })

  it('scopes the note search to the selected project (#262)', async () => {
    const lkv = lkvMock()
    lkv.projects.list.mockResolvedValue([{ name: 'Biology', count: 2 }])
    render(<ReviewView project="Biology" onProjectChange={() => {}} />)
    fireEvent.change(screen.getByLabelText(/Search your notes/i), { target: { value: 'photosynthesis' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() =>
      expect(lkv.search.query).toHaveBeenCalledWith({ text: 'photosynthesis', limit: 8, filters: { project: 'Biology' } }),
    )
  })

  it('says "Already in Study" for a note that already has cards (#263)', async () => {
    const lkv = lkvMock()
    lkv.search.query.mockResolvedValue({
      hits: [makeHit('itm_9', { title: 'Cell biology' }), makeHit('itm_8', { title: 'Genetics' })],
    })
    lkv.review.enrolled.mockResolvedValue(['itm_9'])
    render(<ReviewView />)

    fireEvent.change(screen.getByLabelText(/Search your notes/i), { target: { value: 'cell' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('Already in Study')).toBeInTheDocument()
    expect(lkv.review.enrolled).toHaveBeenCalledWith(['itm_9', 'itm_8'])
    // Only the other note offers Add.
    expect(screen.getAllByRole('button', { name: 'Add to review' })).toHaveLength(1)
  })

  it('turns a late "already enrolled" answer into Already in Study', async () => {
    const lkv = lkvMock()
    lkv.search.query.mockResolvedValue({ hits: [makeHit('itm_9', { title: 'Cell biology' })] })
    lkv.review.enqueue.mockResolvedValue({ created: 0, cards: 3, alreadyEnrolled: true })
    render(<ReviewView />)

    fireEvent.change(screen.getByLabelText(/Search your notes/i), { target: { value: 'cell' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add to review' }))
    expect(await screen.findByText('“Cell biology” is already in Study.')).toBeInTheDocument()
    expect(screen.getByText('Already in Study')).toBeInTheDocument()
  })

  it('scopes the session to the selected project', async () => {
    const lkv = lkvMock()
    lkv.projects.list.mockResolvedValue([{ name: 'Work', count: 2 }])
    render(<ReviewView />)

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Project' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Work' }))
    await waitFor(() => expect(lkv.review.count).toHaveBeenCalledWith({ project: 'Work' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
    await waitFor(() => expect(lkv.study.startSession).toHaveBeenCalledWith({ project: 'Work', limit: 20 }))
  })
})
