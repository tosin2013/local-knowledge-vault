import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { NotePeek, type NotePeekProps } from '../../src/features/NotePeek'
import { makeItem } from './lkv'

function makeProps(overrides: Partial<NotePeekProps> = {}): NotePeekProps {
  return {
    open: true,
    isNewDraft: false,
    draft: makeItem('itm_1', { title: 'My note', body: 'Body text' }),
    peekEditing: false,
    dirty: false,
    busy: false,
    advanced: false,
    projectOptions: [],
    onClose: vi.fn(),
    onEdit: vi.fn(),
    onPatch: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onConfirmDraft: vi.fn(),
    onCopyId: vi.fn(),
    ...overrides,
  }
}

describe('NotePeek', () => {
  it('renders a viewing note with an Edit button', () => {
    const props = makeProps()
    render(<NotePeek {...props} />)
    expect(screen.getByText('Viewing note')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Edit'))
    expect(props.onEdit).toHaveBeenCalledWith(true)
  })

  it('renders an editing note and patches fields', () => {
    const props = makeProps({ peekEditing: true, dirty: true })
    render(<NotePeek {...props} />)
    expect(screen.getByText('Editing note')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'New title' } })
    expect(props.onPatch).toHaveBeenCalledWith('title', 'New title')
    fireEvent.change(screen.getByPlaceholderText('Write your note…'), { target: { value: 'body' } })
    expect(props.onPatch).toHaveBeenCalledWith('body', 'body')
  })

  it('saves and deletes', () => {
    const props = makeProps({ peekEditing: true, dirty: true })
    render(<NotePeek {...props} />)
    fireEvent.click(screen.getByText('Save'))
    expect(props.onSave).toHaveBeenCalled()
    fireEvent.click(screen.getByText('Delete'))
    expect(props.onDelete).toHaveBeenCalled()
  })

  it('renders a new-note draft without a delete button', () => {
    const props = makeProps({ isNewDraft: true, draft: makeItem('__draft_new__'), peekEditing: true })
    render(<NotePeek {...props} />)
    expect(screen.getByText('New note')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('renders a project picker with existing projects', () => {
    const props = makeProps({ peekEditing: true, projectOptions: ['Work', 'Home'] })
    render(<NotePeek {...props} />)
    expect(screen.getByLabelText('Project')).toBeInTheDocument()
  })

  it('shows an AI-draft badge and confirms it', () => {
    const props = makeProps({
      peekEditing: true,
      draft: makeItem('itm_1', { title: 'Saved answer', status: 'ai-draft' }),
    })
    render(<NotePeek {...props} />)
    expect(screen.getByText('AI draft')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Confirm draft'))
    expect(props.onConfirmDraft).toHaveBeenCalled()
  })

  it('shows Delete in view mode', () => {
    const props = makeProps({ peekEditing: false, draft: makeItem('itm_1', { title: 'My note' }) })
    render(<NotePeek {...props} />)
    fireEvent.click(screen.getByText('Delete'))
    expect(props.onDelete).toHaveBeenCalled()
  })

  it('allows inline title editing in view mode', () => {
    const props = makeProps({ peekEditing: false, draft: makeItem('itm_1', { title: 'My note' }) })
    render(<NotePeek {...props} />)
    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Renamed' } })
    expect(props.onPatch).toHaveBeenCalledWith('title', 'Renamed')
  })

  it('shows the copy-id affordance in advanced mode', () => {
    const props = makeProps({ advanced: true })
    render(<NotePeek {...props} />)
    fireEvent.click(screen.getByText('Copy id'))
    expect(props.onCopyId).toHaveBeenCalledWith('itm_1')
  })

  it('closes from the close button', () => {
    const props = makeProps()
    render(<NotePeek {...props} />)
    fireEvent.click(screen.getByLabelText('Close note peek'))
    expect(props.onClose).toHaveBeenCalled()
  })
})
