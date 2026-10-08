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
        itemId: 'itm_1',
        grade: 'good',
        targetDate: undefined,
      }),
    )

    // Moving to the next item drains the queue.
    expect(await screen.findByText('Nothing due.')).toBeInTheDocument()
  })

  it('passes the target exam date through to grading', async () => {
    const lkv = lkvMock()
    lkv.review.listDue.mockResolvedValue([NOTE])
    render(<ReviewView />)

    fireEvent.change(await screen.findByLabelText(/Target exam date/i), {
      target: { value: '2026-06-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Easy' }))

    await waitFor(() =>
      expect(lkv.review.rate).toHaveBeenCalledWith({
        itemId: 'itm_1',
        grade: 'easy',
        targetDate: '2026-06-01',
      }),
    )
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
      expect(lkv.review.enqueue).toHaveBeenCalledWith({
        itemId: 'itm_9',
        targetDate: undefined,
      }),
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
