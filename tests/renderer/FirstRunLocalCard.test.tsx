import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { aiChipLabel, FirstRunLocalCard, SmallModelHint } from '../../src/components/ai/FirstRunLocalCard'
import { makeLlmStatus, makeProvider } from './lkv'

describe('aiChipLabel', () => {
  it('returns a placeholder for no status', () => {
    expect(aiChipLabel(null, false)).toBe('AI: …')
  })

  it('labels a local active provider', () => {
    const status = makeLlmStatus({
      active: { id: 'ollama', label: 'Ollama', kind: 'ollama', local: true, model: 'qwen3:8b' },
    })
    expect(aiChipLabel(status, false)).toBe('Local · Ollama · qwen3:8b')
  })

  it('labels a cloud active provider', () => {
    const status = makeLlmStatus({
      active: { id: 'groq', label: 'Groq', kind: 'openai-compatible', local: false, model: 'gpt-oss-20b' },
    })
    expect(aiChipLabel(status, false)).toBe('Cloud · Groq · gpt-oss-20b')
  })

  it('describes the setup-needed state', () => {
    const status = makeLlmStatus({ needsSetup: true, active: null })
    expect(aiChipLabel(status, true)).toBe('AI: no local model detected')
    expect(aiChipLabel(status, false)).toBe('AI: set up local model')
  })

  it('falls back to the message when unavailable', () => {
    const status = makeLlmStatus({ active: null, needsSetup: false, message: 'offline' })
    expect(aiChipLabel(status, true)).toBe('offline')
    expect(aiChipLabel(status, false)).toBe('AI: not available — search still works')
  })
})

describe('FirstRunLocalCard', () => {
  const baseProps = {
    status: makeLlmStatus({
      recommendedLocalModel: { name: 'qwen3:8b', command: 'ollama pull qwen3:8b', why: 'Small and good.' },
    }),
    checking: false,
    onRecheck: vi.fn(),
    onUseCloud: vi.fn(),
  }

  it('renders the recommended model and command', () => {
    render(<FirstRunLocalCard {...baseProps} />)
    expect(screen.getByText('qwen3:8b')).toBeInTheDocument()
    expect(screen.getByText('ollama pull qwen3:8b')).toBeInTheDocument()
  })

  it('describes a running Ollama with no models', () => {
    const status = makeLlmStatus({
      providers: [makeProvider('ollama', { health: { ok: true, models: [] } })],
    })
    render(<FirstRunLocalCard {...baseProps} status={status} />)
    expect(screen.getByText(/Ollama is running but has no models yet/)).toBeInTheDocument()
  })

  it('describes a missing local model by default', () => {
    render(<FirstRunLocalCard {...baseProps} />)
    expect(screen.getByText(/Start Ollama or LM Studio/)).toBeInTheDocument()
  })

  it('fires onRecheck and onUseCloud', () => {
    render(<FirstRunLocalCard {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }))
    expect(baseProps.onRecheck).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Use a cloud model instead' }))
    expect(baseProps.onUseCloud).toHaveBeenCalled()
  })

  it('opens the Ollama and LM Studio links', () => {
    render(<FirstRunLocalCard {...baseProps} />)
    fireEvent.click(screen.getByText('Get Ollama'))
    expect(window.lkv.app.openExternal).toHaveBeenCalledWith('https://ollama.com/download')
    fireEvent.click(screen.getByText('Get LM Studio'))
    expect(window.lkv.app.openExternal).toHaveBeenCalledWith('https://lmstudio.ai')
  })
})

describe('SmallModelHint', () => {
  it('renders the hint and dismisses', () => {
    const onDismiss = vi.fn()
    render(
      <SmallModelHint
        active={{ id: 'ollama', label: 'Ollama', kind: 'ollama', local: true, model: 'qwen3:1b' }}
        recommended="qwen3:8b"
        onDismiss={onDismiss}
      />,
    )
    expect(screen.getByText(/small model/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Dismiss hint'))
    expect(onDismiss).toHaveBeenCalled()
  })
})
