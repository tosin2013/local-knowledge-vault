import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FindPanel, type FindPanelProps } from '../../src/features/FindPanel'
import { makeAskResult, makeHit } from './lkv'

function makeProps(overrides: Partial<FindPanelProps> = {}): FindPanelProps {
  return {
    advanced: false,
    askResult: null,
    hits: [],
    searchText: '',
    filters: { para: '', kind: '', status: '', project: '' },
    filterSummary: 'All notes',
    hasMore: false,
    onSelect: vi.fn(),
    onAskInstead: vi.fn(),
    onShowMore: vi.fn(),
    ...overrides,
  }
}

describe('FindPanel', () => {
  it('shows the empty search prompt and Ask instead', () => {
    const props = makeProps()
    render(<FindPanel {...props} />)
    expect(screen.getByText(/Search to find notes/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Ask instead'))
    expect(props.onAskInstead).toHaveBeenCalled()
  })

  it('shows "no notes match" when there are filters', () => {
    render(<FindPanel {...makeProps({ searchText: 'x' })} />)
    expect(screen.getByText('No notes match these filters')).toBeInTheDocument()
  })

  it('renders an answer with citations', () => {
    const props = makeProps({ askResult: makeAskResult({ answer: 'The answer', citations: [{ id: 'itm_1', title: 'Note A' }] }) })
    render(<FindPanel {...props} />)
    expect(screen.getByText('The answer')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Note A'))
    expect(props.onSelect).toHaveBeenCalledWith('itm_1')
  })

  it('renders an offline warning', () => {
    render(<FindPanel {...makeProps({ askResult: makeAskResult({ offline: true }) })} />)
    expect(screen.getByText(/AI unavailable/)).toBeInTheDocument()
  })

  it('renders results and selects a hit', () => {
    const props = makeProps({ hits: [makeHit('itm_1', { title: 'Hit one', score: 0.95 })] })
    render(<FindPanel {...props} />)
    expect(screen.getByText('Results (1)')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Hit one'))
    expect(props.onSelect).toHaveBeenCalledWith('itm_1')
  })

  it('shows score in advanced mode', () => {
    render(<FindPanel {...makeProps({ advanced: true, hits: [makeHit('itm_1')] })} />)
    expect(screen.getByText(/score/)).toBeInTheDocument()
  })

  it('shows a Show more button when more results are available', () => {
    const props = makeProps({ hasMore: true, hits: [makeHit('itm_1', { title: 'Hit one' })] })
    render(<FindPanel {...props} />)
    fireEvent.click(screen.getByText('Show more'))
    expect(props.onShowMore).toHaveBeenCalled()
  })
})
