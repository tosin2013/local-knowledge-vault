import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ProvidersPanel } from '../../src/components/ai/ProvidersPanel'
import { makeLlmStatus, makeProvider } from './lkv'

const local = makeProvider('ollama', {
  label: 'Ollama',
  local: true,
  health: { ok: true, models: ['qwen3:8b', 'llama3'] },
})
const cloud = makeProvider('groq', {
  label: 'Groq',
  kind: 'openai-compatible',
  local: false,
  requiresKey: true,
  hasKey: false,
  baseUrl: 'https://api.groq.com/openai/v1',
  model: 'gpt-oss-20b',
})

function makeProps(overrides: Partial<Parameters<typeof ProvidersPanel>[0]> = {}) {
  return {
    status: makeLlmStatus({ providers: [local, cloud], selected: 'auto', message: 'online' }),
    checking: false,
    onRefresh: vi.fn(),
    onAdd: vi.fn(),
    onEdit: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  }
}

describe('ProvidersPanel', () => {
  it('lists local and cloud providers with health chips', () => {
    render(<ProvidersPanel {...makeProps()} />)
    expect(screen.getByText('Ollama')).toBeInTheDocument()
    expect(screen.getByText('Groq')).toBeInTheDocument()
    expect(screen.getByText('Running · 2 models')).toBeInTheDocument()
    expect(screen.getByText('Needs key')).toBeInTheDocument()
  })

  it('toggles a provider on and off', () => {
    render(<ProvidersPanel {...makeProps()} />)
    fireEvent.click(screen.getByLabelText('Enable Ollama'))
    expect(window.lkv.providers.setEnabled).toHaveBeenCalledWith('ollama', false)
  })

  it('adds and edits providers', () => {
    const props = makeProps()
    render(<ProvidersPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }))
    expect(props.onAdd).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Edit Groq'))
    expect(props.onEdit).toHaveBeenCalledWith(cloud)
  })

  it('removes a removable provider after confirm', () => {
    const user = makeProvider('my', { source: 'user', label: 'Mine', local: false })
    render(<ProvidersPanel {...makeProps({ status: makeLlmStatus({ providers: [user] }) })} />)
    fireEvent.click(screen.getByLabelText('Remove Mine'))
    expect(window.lkv.providers.remove).toHaveBeenCalledWith('my')
  })

  it('changes the selected provider', () => {
    render(<ProvidersPanel {...makeProps()} />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Use' }))
    fireEvent.click(screen.getByRole('option', { name: 'Ollama only (local)' }))
    expect(window.lkv.providers.setSelected).toHaveBeenCalledWith('ollama')
  })

  it('shows the fixed-to-one warning when a provider is selected', () => {
    render(<ProvidersPanel {...makeProps({ status: makeLlmStatus({ providers: [local, cloud], selected: 'ollama' }) })} />)
    expect(screen.getByText(/Fixed to one provider/)).toBeInTheDocument()
  })

  it('re-checks providers', () => {
    const props = makeProps()
    render(<ProvidersPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }))
    expect(props.onRefresh).toHaveBeenCalled()
  })
})
