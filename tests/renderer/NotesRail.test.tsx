import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { NotesRail, type NotesRailProps } from '../../src/features/NotesRail'
import { makeItem } from './lkv'

function makeProps(overrides: Partial<NotesRailProps> = {}): NotesRailProps {
  return {
    advanced: false,
    items: [],
    isEmpty: false,
    selectedId: null,
    filters: { para: '', kind: '', status: '', project: '' },
    projectOptions: [],
    filterSummary: 'All notes',
    filtersOpen: false,
    importUrl: '',
    importBusy: false,
    importMarkdownBusy: false,
    busy: false,
    railQuery: '',
    railSort: 'updated',
    showTranscripts: false,
    onNewNote: vi.fn(),
    onNewProject: vi.fn(),
    onImportUrl: vi.fn(),
    onImport: vi.fn(),
    onImportMarkdown: vi.fn(),
    onProject: vi.fn(),
    onManageProjects: vi.fn(),
    onDeleteItem: vi.fn(),
    onRailQuery: vi.fn(),
    onRailSort: vi.fn(),
    onShowTranscripts: vi.fn(),
    onOpenTrash: vi.fn(),
    hasSamples: false,
    onRemoveSamples: vi.fn(),
    bulkSelected: new Set<string>(),
    onToggleBulk: vi.fn(),
    onBulkTrash: vi.fn(),
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

  it('creates a project from the New project field', () => {
    const props = makeProps()
    render(<NotesRail {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    fireEvent.change(screen.getByPlaceholderText('Project name'), { target: { value: 'Work' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(props.onNewProject).toHaveBeenCalledWith('Work')
  })

  it('fires onImportMarkdown from the Import Markdown button', () => {
    const props = makeProps()
    render(<NotesRail {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Import Markdown' }))
    expect(props.onImportMarkdown).toHaveBeenCalled()
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

  it('shows the filtered empty state when there are no matching notes', () => {
    render(<NotesRail {...makeProps({ isEmpty: false })} />)
    expect(screen.getByText('No notes match filters.')).toBeInTheDocument()
    expect(screen.queryByText('Create your first note')).not.toBeInTheDocument()
  })

  it('shows a "Create your first note" empty state for a genuinely empty vault', () => {
    const props = makeProps({ isEmpty: true })
    render(<NotesRail {...props} />)
    expect(screen.getByText('Your vault is empty.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create your first note' }))
    expect(props.onNewNote).toHaveBeenCalled()
  })

  it('shows a bulk trash button when notes are selected', () => {
    const props = makeProps({ bulkSelected: new Set(['itm_1']), items: [makeItem('itm_1', { title: 'First note' })] })
    render(<NotesRail {...props} />)
    fireEvent.click(screen.getByText('Trash 1 selected'))
    expect(props.onBulkTrash).toHaveBeenCalled()
  })

  it('opens the trash dialog', () => {
    const props = makeProps()
    render(<NotesRail {...props} />)
    fireEvent.click(screen.getByText('Trash'))
    expect(props.onOpenTrash).toHaveBeenCalled()
  })

  it('shows the Remove guide action while guide notes exist', () => {
    const props = makeProps({ hasSamples: true })
    render(<NotesRail {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove guide' }))
    expect(props.onRemoveSamples).toHaveBeenCalled()
  })

  it('hides the Remove guide action when there are no guide notes', () => {
    render(<NotesRail {...makeProps({ hasSamples: false })} />)
    expect(screen.queryByRole('button', { name: 'Remove guide' })).not.toBeInTheDocument()
  })

  it('changes project filter', () => {
    const props = makeProps({ projectOptions: ['Work'] })
    render(<NotesRail {...props} />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Project' }))
    fireEvent.click(screen.getByRole('option', { name: 'Work' }))
    expect(props.onProject).toHaveBeenCalledWith('Work')
  })

  it('opens the manage-projects dialog from the rail', () => {
    const props = makeProps()
    render(<NotesRail {...props} />)
    fireEvent.click(screen.getByLabelText('Manage projects'))
    expect(props.onManageProjects).toHaveBeenCalled()
  })

  it('deletes a note from the rail without opening it', () => {
    const props = makeProps({ items: [makeItem('itm_1', { title: 'First note' })] })
    render(<NotesRail {...props} />)
    fireEvent.click(screen.getByLabelText('Delete First note'))
    expect(props.onDeleteItem).toHaveBeenCalledWith('itm_1')
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

  it('shows the URL import form in simple mode', () => {
    render(<NotesRail {...makeProps({ advanced: false })} />)
    expect(screen.getByText('Add from URL')).toBeInTheDocument()
    expect(screen.getByLabelText('URL to import')).toBeInTheDocument()
  })
})
