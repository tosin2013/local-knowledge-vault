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
    onExportPrompt: vi.fn(),
    onImportPrompt: vi.fn(),
    shareNotice: '',
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

  it('shows guidance and starter templates in the editor', () => {
    render(<PromptsView {...makeProps({ promptBodyOpen: true })} />)
    expect(screen.getByText('What a personality can change')).toBeInTheDocument()
    expect(screen.getByText(/grounding, citations and .I don.t know./)).toBeInTheDocument()
    expect(screen.getByText('Concise bullets')).toBeInTheDocument()
    expect(screen.getByText('Explain like a teacher')).toBeInTheDocument()
    expect(screen.getByText('Meeting prep')).toBeInTheDocument()
    expect(screen.getByText('Executive summary')).toBeInTheDocument()
    expect(screen.getByText('Storyteller')).toBeInTheDocument()
    expect(screen.getByText('Debate partner')).toBeInTheDocument()
    expect(screen.getByText('Study guide')).toBeInTheDocument()
  })

  it('fills name/description/instructions when a template is chosen', () => {
    const props = makeProps({ promptBodyOpen: true })
    render(<PromptsView {...props} />)
    fireEvent.click(screen.getByText('Concise bullets'))
    expect(props.onDraft).toHaveBeenCalled()
    const updater = vi.mocked(props.onDraft).mock.calls[0][0] as (d: PromptDraft) => PromptDraft
    const filled = updater({ name: '', body: '', description: '' })
    expect(filled.name).toBe('Concise bullets')
    expect(filled.description).toBe('Short bullet-list answers')
    expect(filled.body).toContain('bullet points')
    expect(props.onDirty).toHaveBeenCalledWith(true)
  })

  it('copies the helper prompt to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<PromptsView {...makeProps({ promptBodyOpen: true })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy helper prompt' }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Vault answers only from my own notes'))
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('imports a personality from a file', () => {
    const props = makeProps()
    render(<PromptsView {...props} />)
    fireEvent.click(screen.getByText('Import personality'))
    expect(props.onImportPrompt).toHaveBeenCalled()
  })

  it('exports and copies the selected personality as JSON', () => {
    const props = makeProps({
      editingPrompt: makePrompt('prm_1', 'Concise', 'Be concise'),
      promptBodyOpen: true,
      promptDraft: { name: 'Concise', body: 'Be concise', description: '' },
    })
    render(<PromptsView {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(props.onExportPrompt).toHaveBeenCalledWith('file')
    fireEvent.click(screen.getByRole('button', { name: 'Copy JSON' }))
    expect(props.onExportPrompt).toHaveBeenCalledWith('clipboard')
  })

  it('previews the draft against the notes', async () => {
    const props = makeProps({
      promptBodyOpen: true,
      promptDraft: { name: 'Concise', body: 'Be concise', description: '' },
    })
    render(<PromptsView {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByText('Preview: Concise')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Run preview' }))
    expect(await screen.findByText(/Preview answer/)).toBeInTheDocument()
    expect(window.lkv.prompts.preview).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Be concise', compare: false }),
    )
  })
})
