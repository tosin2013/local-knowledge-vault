import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { NotesRail, type NotesRailProps } from '../../src/features/NotesRail'
import { makeItem } from './lkv'

function makeProps(overrides: Partial<NotesRailProps> = {}): NotesRailProps {
  return {
    advanced: false,
    items: [],
    selectedId: null,
    filters: { para: '', kind: '', status: '', project: '' },
    projectOptions: [],
    filterSummary: 'All notes',
    filtersOpen: false,
    importUrl: '',
    importBusy: false,
    busy: false,
    onNewNote: vi.fn(),
    onImportUrl: vi.fn(),
    onImport: vi.fn(),
    onProject: vi.fn(),
    onFilters: vi.fn(),
    onFiltersOpen: vi.fn(),
    onSelect: vi.fn(),
    ...overrides,
  }
}

describe('NotesRail', () => {
  it('renders the New note button and fires onNewNote', () => {
    const props = makeProps()
    render(<NotesRail {...props} />)
    fireEvent.click(screen.getByText('New note'))
    expect(props.onNewNote).toHaveBeenCalled()
  })

  it('lists notes and selects them on click and double-click', () => {
    const props = makeProps({ items: [makeItem('itm_1', { title: 'First note', project: 'Work' })] })
    render(<NotesRail {...props} />)
    fireEvent.click(screen.getByText('First note'))
    expect(props.onSelect).toHaveBeenCalledWith('itm_1')
    fireEvent.doubleClick(screen.getByText('First note'))
    expect(props.onSelect).toHaveBeenCalledWith('itm_1', { edit: true })
  })

  it('edits a note with F2 (keyboard equivalent of double-click)', () => {
    const props = makeProps({ items: [makeItem('itm_1', { title: 'First note' })] })
    render(<NotesRail {...props} />)
    const item = screen.getByText('First note').closest('[role="button"]') as HTMLElement
    fireEvent.keyDown(item, { key: 'F2' })
    expect(props.onSelect).toHaveBeenCalledWith('itm_1', { edit: true })
  })

  it('labels the notes list for screen readers', () => {
    render(<NotesRail {...makeProps({ items: [makeItem('itm_1', { title: 'First note' })] })} />)
    expect(screen.getByRole('list', { name: 'Notes' })).toBeInTheDocument()
  })

  it('shows the empty state when there are no notes', () => {
    render(<NotesRail {...makeProps()} />)
    expect(screen.getByText('No notes match filters.')).toBeInTheDocument()
  })

  it('changes project filter', () => {
    const props = makeProps({ projectOptions: ['Work'] })
    render(<NotesRail {...props} />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Project' }))
    fireEvent.click(screen.getByRole('option', { name: 'Work' }))
    expect(props.onProject).toHaveBeenCalledWith('Work')
  })

  it('toggles more filters in simple mode', () => {
    const props = makeProps({ advanced: false, filtersOpen: false })
    render(<NotesRail {...props} />)
    fireEvent.click(screen.getByText('More filters'))
    expect(props.onFiltersOpen).toHaveBeenCalledWith(true)
  })

  it('shows extra filters when open and changes kind/status', () => {
    const props = makeProps({ advanced: false, filtersOpen: true })
    render(<NotesRail {...props} />)
    fireEvent.mouseDown(screen.getByLabelText('Type'))
    fireEvent.click(screen.getByRole('option', { name: 'book' }))
    expect(props.onFilters).toHaveBeenCalled()
  })

  it('renders PARA chips and import form in advanced mode', () => {
    const props = makeProps({ advanced: true })
    render(<NotesRail {...props} />)
    expect(screen.getByText('Add from URL')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Projects'))
    expect(props.onFilters).toHaveBeenCalled()
  })

  it('imports a URL from the import field', () => {
    const props = makeProps({ advanced: true, importUrl: 'https://example.com' })
    render(<NotesRail {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(props.onImport).toHaveBeenCalled()
  })
})
