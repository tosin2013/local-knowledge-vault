import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReviewView } from '../../src/features/study/ReviewView'
import { lkvMock, makeHit, makeReviewItem } from './lkv'

const NOTE = makeReviewItem('itm_1', {
  title: 'Photosynthesis',
  body: 'Chlorophyll captures light to make glucose from CO2 and water.',
})

describe('ReviewView', () => {
  it('shows the empty state when nothing is due', async () => {
    render(<ReviewView />)
    expect(await screen.findByText('Nothing due.')).toBeInTheDocument()
    expect(lkvMock().review.listDue).toHaveBeenCalled()
  })

  it('prompts with the title, reveals the note on Show answer, and grades it', async () => {
    const lkv = lkvMock()
    lkv.review.listDue.mockResolvedValue([NOTE])
    render(<ReviewView />)

    // The title is the recall prompt; the body stays hidden until revealed.
    expect(await screen.findByText('Photosynthesis')).toBeInTheDocument()
    expect(screen.queryByText(/Chlorophyll captures light/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Good' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
    expect(await screen.findByText(/Chlorophyll captures light/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Good' }))
    await waitFor(() =>
      expect(lkv.review.rate).toHaveBeenCalledWith({
        cardId: 'crd_itm_1',
        grade: 'good',
      }),
    )

    // Moving to the next item drains the queue.
    expect(await screen.findByText('Nothing due.')).toBeInTheDocument()
  })

  it('keeps the due card usable when search results overflow the panel', async () => {
    const lkv = lkvMock()
    lkv.review.listDue.mockResolvedValue([NOTE])
    lkv.search.query.mockResolvedValue({
      hits: Array.from({ length: 8 }, (_, i) => makeHit(`itm_${i}`, { title: `Result ${i}` })),
    })
    render(<ReviewView />)

    expect(await screen.findByText('Photosynthesis')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Search your notes/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('Result 0')).toBeInTheDocument()

    // The due card's prompt and Reveal stay usable alongside overflowing results.
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
    expect(await screen.findByText(/Chlorophyll captures light/)).toBeInTheDocument()
  })

  it('shows the content summary as the recall prompt instead of a page title', async () => {
    const lkv = lkvMock()
    lkv.review.listDue.mockResolvedValue([
      makeReviewItem('itm_2', {
        title: 'Bio · p.4',
        summary: 'Photosynthesis captures light energy.',
        body: 'Photosynthesis captures light energy to make glucose.',
      }),
    ])
    render(<ReviewView />)

    // The recall prompt is the content summary, not the bare "file · p.N" title.
    expect(await screen.findByText('Photosynthesis captures light energy.')).toBeInTheDocument()
    expect(screen.queryByText('Bio · p.4')).not.toBeInTheDocument()
  })

  it('shows the project exam date and grades without sending a date', async () => {
    const lkv = lkvMock()
    lkv.projects.list.mockResolvedValue([{ name: 'Biology', count: 2, examDate: '2099-06-01' }])
    lkv.projects.getSettings.mockResolvedValue({ name: 'Biology', examDate: '2099-06-01' })
    lkv.review.listDue.mockResolvedValue([NOTE])
    render(<ReviewView />)

    // All projects has no exam date.
    expect(await screen.findByTestId('exam-date-none')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Target exam date/i)).not.toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Project' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Biology' }))
    expect(await screen.findByText('Jun 1, 2099')).toBeInTheDocument()
    expect(lkv.projects.getSettings).toHaveBeenCalledWith('Biology')

    fireEvent.click(await screen.findByRole('button', { name: 'Show answer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Easy' }))
    // The main process reads the date from the card's project.
    await waitFor(() => expect(lkv.review.rate).toHaveBeenCalledWith({ cardId: 'crd_itm_1', grade: 'easy' }))
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
      expect(lkv.review.enqueue).toHaveBeenCalledWith({ itemId: 'itm_9' }),
    )
    expect(await screen.findByText('Added “Cell biology” to review.')).toBeInTheDocument()
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

  it('reveals only the chunk for a chunk card and labels the part', async () => {
    const lkv = lkvMock()
    lkv.review.listDue.mockResolvedValue([
      makeReviewItem('itm_3', {
        title: 'Cell transport chapter',
        body: 'Whole chapter text. Diffusion section. Osmosis section.',
        card_id: 'crd_part2',
        chunk_index: 1,
        chunk_count: 3,
        card_text: 'Osmosis section.',
      }),
    ])
    render(<ReviewView />)

    expect(await screen.findByText('Part 2 of 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
    expect(await screen.findByText('Osmosis section.')).toBeInTheDocument()
    expect(screen.queryByText(/Whole chapter text/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Good' }))
    await waitFor(() =>
      expect(lkv.review.rate).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'crd_part2', grade: 'good' })),
    )
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

  it('scopes the due list to the selected project', async () => {
    const lkv = lkvMock()
    lkv.projects.list.mockResolvedValue([{ name: 'Work', count: 2 }])
    lkv.review.listDue.mockResolvedValue([NOTE])
    render(<ReviewView />)

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Project' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Work' }))

    await waitFor(() =>
      expect(lkv.review.listDue).toHaveBeenCalledWith({ limit: 50, project: 'Work' }),
    )
  })
})
