import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TrashDialog } from '../../src/features/TrashDialog'
import { makeItem } from './lkv'

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    items: [makeItem('itm_1', { title: 'Trashed note' })],
    busy: false,
    onClose: vi.fn(),
    onRestore: vi.fn(),
    onEmpty: vi.fn(),
    ...overrides,
  }
}

describe('TrashDialog', () => {
  it('lists trashed notes and restores one', () => {
    const props = makeProps()
    render(<TrashDialog {...props} />)
    expect(screen.getByText('Trashed note')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Restore'))
    expect(props.onRestore).toHaveBeenCalledWith('itm_1')
  })

  it('empties the trash after confirm', () => {
    const props = makeProps()
    render(<TrashDialog {...props} />)
    fireEvent.click(screen.getByText('Empty trash'))
    expect(props.onEmpty).toHaveBeenCalled()
  })

  it('shows the empty state', () => {
    render(<TrashDialog {...makeProps({ items: [] })} />)
    expect(screen.getByText('Trash is empty.')).toBeInTheDocument()
  })
})
