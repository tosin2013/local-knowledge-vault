import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { INITIAL_NOTES_SHOWN, NOTES_SHOWN_STEP, NotesRail } from '../../src/features/NotesRail'
import { makeItem } from './lkv'
import type { Item } from '../../electron/types'

function manyItems(n: number): Item[] {
  return Array.from({ length: n }, (_, i) =>
    makeItem(`itm_${i}`, { title: `Note ${i}`, project: i % 3 === 0 ? 'Bio' : null }),
  )
}

function renderRail(items: Item[]) {
  const onSelect = vi.fn()
  const onToggleBulk = vi.fn()
  const onDeleteItem = vi.fn()
  const utils = render(
    <NotesRail
      advanced
      items={items}
      isEmpty={false}
      selectedId={null}
      filters={{}}
      projectOptions={['Bio']}
      filterSummary="All notes"
      filtersOpen={false}
      importUrl=""
      importBusy={false}
      importMarkdownBusy={false}
      importBookBusy={false}
      busy={false}
      railQuery=""
      railSort="updated"
      showTranscripts={false}
      onNewNote={vi.fn()}
      onNewProject={vi.fn()}
      onImportUrl={vi.fn()}
      onImport={vi.fn()}
      onImportMarkdown={vi.fn()}
      onImportBook={vi.fn()}
      onProject={vi.fn()}
      onManageProjects={vi.fn()}
      onDeleteItem={onDeleteItem}
      onRailQuery={vi.fn()}
      onRailSort={vi.fn()}
      onShowTranscripts={vi.fn()}
      onOpenTrash={vi.fn()}
      hasSamples={false}
      onRemoveSamples={vi.fn()}
      bulkSelected={new Set()}
      onToggleBulk={onToggleBulk}
      onBulkTrash={vi.fn()}
      onFilters={vi.fn()}
      onFiltersOpen={vi.fn()}
      onSelect={onSelect}
    />,
  )
  return { ...utils, onSelect, onToggleBulk, onDeleteItem }
}

function renderedRowCount(): number {
  return screen.getByRole('list', { name: 'Notes' }).children.length
}

describe('NotesRail windowing (#294)', () => {
  it('renders a bounded window with hundreds of notes and shows the true total', () => {
    const { container } = renderRail(manyItems(350))
    expect(renderedRowCount()).toBe(INITIAL_NOTES_SHOWN)
    expect(screen.getByText(/350 notes/)).toBeInTheDocument()
    // The issue's DOM criterion: .note-list stays far below 2,000 nodes.
    const list = screen.getByTestId('note-list')
    expect(list.querySelectorAll('*').length).toBeLessThan(2000)
    expect(container).toBeDefined()
  })

  it('extends the window as the list scrolls, capped at the note count', () => {
    renderRail(manyItems(350))
    const list = screen.getByTestId('note-list')
    // jsdom reports zero dimensions, so one scroll event reaches the threshold.
    fireEvent.scroll(list)
    expect(renderedRowCount()).toBe(INITIAL_NOTES_SHOWN + NOTES_SHOWN_STEP)
    fireEvent.scroll(list)
    expect(renderedRowCount()).toBe(350)
    // Extra scrolling past the end changes nothing.
    fireEvent.scroll(list)
    expect(renderedRowCount()).toBe(350)
  })

  it('starts a fresh window when a new filtered list arrives', () => {
    const items = manyItems(350)
    const first = renderRail(items)
    fireEvent.scroll(first.getByTestId('note-list'))
    expect(renderedRowCount()).toBe(INITIAL_NOTES_SHOWN + NOTES_SHOWN_STEP)
    // The app passes a fresh filtered array on every refresh/filter change.
    first.rerender(
      <NotesRail
        advanced
        items={manyItems(350)}
        isEmpty={false}
        selectedId={null}
        filters={{}}
        projectOptions={['Bio']}
        filterSummary="All notes"
        filtersOpen={false}
        importUrl=""
        importBusy={false}
        importMarkdownBusy={false}
        importBookBusy={false}
        busy={false}
        railQuery="note"
        railSort="updated"
        showTranscripts={false}
        onNewNote={vi.fn()}
        onNewProject={vi.fn()}
        onImportUrl={vi.fn()}
        onImport={vi.fn()}
        onImportMarkdown={vi.fn()}
        onImportBook={vi.fn()}
        onProject={vi.fn()}
        onManageProjects={vi.fn()}
        onDeleteItem={vi.fn()}
        onRailQuery={vi.fn()}
        onRailSort={vi.fn()}
        onShowTranscripts={vi.fn()}
        onOpenTrash={vi.fn()}
        hasSamples={false}
        onRemoveSamples={vi.fn()}
        bulkSelected={new Set()}
        onToggleBulk={vi.fn()}
        onBulkTrash={vi.fn()}
        onFilters={vi.fn()}
        onFiltersOpen={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    expect(renderedRowCount()).toBe(INITIAL_NOTES_SHOWN)
  })

  it('keeps row interactions working inside the window', () => {
    const { onSelect, onToggleBulk, onDeleteItem } = renderRail(manyItems(120))
    fireEvent.click(screen.getByText('Note 0'))
    expect(onSelect).toHaveBeenCalledWith('itm_0')
    fireEvent.click(screen.getByLabelText('Select Note 1'))
    expect(onToggleBulk).toHaveBeenCalledWith('itm_1')
    fireEvent.click(screen.getByLabelText('Delete Note 2'))
    expect(onDeleteItem).toHaveBeenCalledWith('itm_2')
  })
})
