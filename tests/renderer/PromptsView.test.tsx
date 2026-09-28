import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PromptsView, type PromptsViewProps, type PromptDraft } from '../../src/features/PromptsView'
import { makePrompt } from './lkv'

function makeProps(overrides: Partial<PromptsViewProps> = {}): PromptsViewProps {
  return {
    advanced: false,
    busy: false,
    prompts: [],
    editingPrompt: null,
    promptBodyOpen: false,
    promptDraft: { name: '', body: '', description: '' },
    promptDirty: false,
    onNewPrompt: vi.fn(),
    onSelectPrompt: vi.fn(),
    onDraft: vi.fn(),
    onDirty: vi.fn(),
    onBodyOpen: vi.fn(),
    onUseInAsk: vi.fn(),
    onDeletePrompt: vi.fn(),
    onSavePrompt: vi.fn(),
    ...overrides,
  }
}

describe('PromptsView', () => {
  it('shows the empty personalities state', () => {
    render(<PromptsView {...makeProps()} />)
    expect(screen.getByText('Personalities')).toBeInTheDocument()
  })

  it('lists prompts and selects one', () => {
    const props = makeProps({ prompts: [makePrompt('prm_1', 'Grounded default')] })
    render(<PromptsView {...props} />)
    fireEvent.click(screen.getByText('Grounded helper'))
    expect(props.onSelectPrompt).toHaveBeenCalled()
  })

  it('creates a new personality', () => {
    const props = makeProps()
    render(<PromptsView {...props} />)
    fireEvent.click(screen.getByText('New personality'))
    expect(props.onNewPrompt).toHaveBeenCalled()
  })

  it('edits name/body and saves', () => {
    const props = makeProps({
      editingPrompt: makePrompt('prm_1', 'Concise'),
      promptBodyOpen: true,
      promptDirty: true,
      promptDraft: { name: 'Concise', body: 'Be concise', description: '' },
    })
    render(<PromptsView {...props} />)
    const name = screen.getByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Concise 2' } })
    expect(props.onDraft).toHaveBeenCalled()
    expect(props.onDirty).toHaveBeenCalledWith(true)

    const instructions = screen.getByLabelText('Instructions')
    fireEvent.change(instructions, { target: { value: 'Be very concise' } })
    expect(props.onDraft).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(props.onSavePrompt).toHaveBeenCalled()
  })

  it('deletes a prompt and uses it in Ask', () => {
    const props = makeProps({ editingPrompt: makePrompt('prm_1', 'Concise'), promptBodyOpen: true })
    render(<PromptsView {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(props.onDeletePrompt).toHaveBeenCalled()
  })

  it('offers Use in Ask for an existing prompt in simple mode', () => {
    const props = makeProps({ editingPrompt: makePrompt('prm_1', 'Concise'), promptBodyOpen: false })
    render(<PromptsView {...props} />)
    fireEvent.click(screen.getByText('Use in Ask'))
    expect(props.onUseInAsk).toHaveBeenCalledWith('prm_1')
  })
})
