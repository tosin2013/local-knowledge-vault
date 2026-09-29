import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ManageProjectsDialog } from '../../src/features/ManageProjectsDialog'

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    projects: [
      { name: 'Work', count: 3 },
      { name: 'Home', count: 1 },
    ],
    busy: false,
    onClose: vi.fn(),
    onRename: vi.fn(),
    onMerge: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
}

describe('ManageProjectsDialog', () => {
  it('lists projects with note counts', () => {
    render(<ManageProjectsDialog {...makeProps()} />)
    expect(screen.getByText('Work')).toBeInTheDocument()
    expect(screen.getByText('3 notes')).toBeInTheDocument()
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('1 note')).toBeInTheDocument()
  })

  it('renames a project', () => {
    const props = makeProps()
    render(<ManageProjectsDialog {...props} />)
    fireEvent.click(screen.getAllByText('Rename')[0])
    fireEvent.change(screen.getByRole('textbox', { name: 'Rename project' }), { target: { value: 'Office' } })
    fireEvent.click(screen.getByText('Save'))
    expect(props.onRename).toHaveBeenCalledWith('Work', 'Office')
  })

  it('merges a project into another', () => {
    const props = makeProps()
    render(<ManageProjectsDialog {...props} />)
    fireEvent.click(screen.getAllByText('Merge into…')[0])
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Merge into' }))
    fireEvent.click(screen.getByRole('option', { name: 'Home' }))
    fireEvent.click(screen.getByText('Merge'))
    expect(props.onMerge).toHaveBeenCalledWith('Work', 'Home')
  })

  it('deletes a project after confirm', () => {
    const props = makeProps()
    render(<ManageProjectsDialog {...props} />)
    fireEvent.click(screen.getAllByText('Delete')[0])
    expect(props.onDelete).toHaveBeenCalledWith('Work')
  })

  it('shows the empty state when there are no projects', () => {
    render(<ManageProjectsDialog {...makeProps({ projects: [] })} />)
    expect(screen.getByText(/No projects yet/)).toBeInTheDocument()
  })
})
