import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProviderDialog } from '../../src/components/ai/ProviderDialog'
import { lkvMock, makePreset, makeProvider } from './lkv'

const presets = [
  makePreset('ollama', { id: 'ollama', kind: 'ollama', label: 'Ollama', local: true, requiresKey: false, baseUrl: 'http://localhost:11434' }),
  makePreset('openrouter', { id: 'openrouter', kind: 'openai-compatible', label: 'OpenRouter', local: false, requiresKey: true, baseUrl: 'https://openrouter.ai/api/v1' }),
]

function makeProps(overrides: Partial<Parameters<typeof ProviderDialog>[0]> = {}) {
  return {
    open: true,
    presets,
    editing: null,
    initialPresetId: undefined,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  }
}

describe('ProviderDialog', () => {
  it('renders the add-provider form with a preset picker', () => {
    render(<ProviderDialog {...makeProps()} />)
    expect(screen.getByText('Add provider')).toBeInTheDocument()
    // The preset picker is present and lists the presets once opened.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Preset' }))
    expect(screen.getByRole('option', { name: 'Ollama' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'OpenRouter' })).toBeInTheDocument()
  })

  it('applies a preset when selected', () => {
    render(<ProviderDialog {...makeProps({ initialPresetId: 'openrouter' })} />)
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://openrouter.ai/api/v1')
    expect(screen.getByLabelText('Name')).toHaveValue('OpenRouter')
  })

  it('shows the API style picker for the custom preset', () => {
    render(<ProviderDialog {...makeProps({ initialPresetId: 'custom' })} />)
    expect(screen.getByLabelText('API style')).toBeInTheDocument()
  })

  it('pre-fills fields when editing and keeps the key write-only', () => {
    const editing = makeProvider('groq', {
      label: 'Groq',
      kind: 'openai-compatible',
      local: false,
      requiresKey: true,
      hasKey: true,
      keySource: 'file',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'gpt-oss-20b',
    })
    render(<ProviderDialog {...makeProps({ editing })} />)
    expect(screen.getByText('Edit Groq')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Groq')
    // The key is never read back from IPC.
    expect(screen.getByLabelText('API key')).toHaveValue('')
    expect(screen.getByPlaceholderText('•••••••• saved — leave blank to keep')).toBeInTheDocument()
  })

  it('says whether a saved key is encrypted on this computer (#237)', () => {
    const { unmount } = render(<ProviderDialog {...makeProps({ initialPresetId: 'openrouter', keyStorage: 'plaintext' })} />)
    expect(screen.getByText(/Not encrypted: this computer has no keychain/)).toBeInTheDocument()
    unmount()
    render(<ProviderDialog {...makeProps({ initialPresetId: 'openrouter', keyStorage: 'encrypted' })} />)
    expect(screen.getByText(/encrypted with your system keychain/)).toBeInTheDocument()
  })

  it('toggles the key visibility', () => {
    render(<ProviderDialog {...makeProps({ initialPresetId: 'openrouter' })} />)
    const key = screen.getByLabelText('API key')
    expect(key).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByLabelText('Show key'))
    expect(key).toHaveAttribute('type', 'text')
  })

  it('offers to remove a saved key', () => {
    const editing = makeProvider('groq', { hasKey: true, keySource: 'file', local: false, requiresKey: true })
    render(<ProviderDialog {...makeProps({ editing })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove saved key on save' }))
    expect(screen.getByRole('button', { name: 'Keep saved key' })).toBeInTheDocument()
  })

  it('fetches models', async () => {
    const lkv = lkvMock()
    lkv.providers.fetchModels.mockResolvedValue({ ok: true, models: ['m1', 'm2'] })
    render(<ProviderDialog {...makeProps({ initialPresetId: 'openrouter' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))
    await waitFor(() => expect(screen.getByText('2 models available')).toBeInTheDocument())
  })

  it('tests the connection', async () => {
    const lkv = lkvMock()
    lkv.providers.test.mockResolvedValue({ ok: true, latencyMs: 42, model: 'm1', sample: 'hi' })
    render(<ProviderDialog {...makeProps({ initialPresetId: 'openrouter' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    await waitFor(() => expect(screen.getByTestId('provider-test-result')).toHaveTextContent('Connected'))
  })

  it('saves the provider', async () => {
    const lkv = lkvMock()
    lkv.providers.save.mockResolvedValue(makeProvider('groq', { label: 'Groq' }))
    const props = makeProps({ initialPresetId: 'openrouter' })
    render(<ProviderDialog {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(lkv.providers.save).toHaveBeenCalled())
    expect(props.onSaved).toHaveBeenCalled()
  })

  it('shows an error when saving fails', async () => {
    const lkv = lkvMock()
    lkv.providers.save.mockRejectedValue(new Error('Save failed'))
    render(<ProviderDialog {...makeProps({ initialPresetId: 'openrouter' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText('Save failed')).toBeInTheDocument())
  })
})
