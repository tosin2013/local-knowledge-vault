import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AiSettingsDialog, type AiSettingsDialogProps } from '../../src/features/AiSettingsDialog'
import { makeLlmStatus, makeProvider } from './lkv'

function makeProps(overrides: Partial<AiSettingsDialogProps> = {}): AiSettingsDialogProps {
  return {
    open: true,
    advanced: true,
    llmStatus: makeLlmStatus({ providers: [makeProvider('ollama')] }),
    llmChecking: false,
    onClose: vi.fn(),
    onRefresh: vi.fn(),
    onAddProvider: vi.fn(),
    onEditProvider: vi.fn(),
    onError: vi.fn(),
    onUseAdvanced: vi.fn(),
    ...overrides,
  }
}

describe('AiSettingsDialog', () => {
  it('renders the providers panel in advanced mode', () => {
    render(<AiSettingsDialog {...makeProps()} />)
    expect(screen.getByText('AI providers')).toBeInTheDocument()
    expect(screen.getByTestId('providers-panel')).toBeInTheDocument()
  })

  it('renders the simple-mode status and buttons', () => {
    const props = makeProps({ advanced: false, llmStatus: makeLlmStatus({ message: 'offline' }) })
    render(<AiSettingsDialog {...props} />)
    expect(screen.getByText('offline')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }))
    expect(props.onAddProvider).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'All providers (Advanced)' }))
    expect(props.onUseAdvanced).toHaveBeenCalled()
  })

  it('shows the first-run card when setup is needed', () => {
    const props = makeProps({ advanced: false, llmStatus: makeLlmStatus({ needsSetup: true }) })
    render(<AiSettingsDialog {...props} />)
    expect(screen.getByTestId('first-run-local-card')).toBeInTheDocument()
  })

  it('renders the bridge settings', () => {
    render(<AiSettingsDialog {...makeProps()} />)
    expect(screen.getByText('Vault Bridge')).toBeInTheDocument()
  })
})
