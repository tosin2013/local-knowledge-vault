import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ContentChrome, type ContentChromeProps } from '../../src/features/ContentChrome'

function makeProps(overrides: Partial<ContentChromeProps> = {}): ContentChromeProps {
  return {
    mode: 'chat',
    activePluginId: null,
    statusMsg: null,
    error: null,
    onToggleMode: vi.fn(),
    onClearPlugin: vi.fn(),
    onClosePlugin: vi.fn(),
    onDismissStatus: vi.fn(),
    onDismissError: vi.fn(),
    onOpenNote: vi.fn(),
    ...overrides,
  }
}

describe('ContentChrome', () => {
  it('switches between Find and Ask', () => {
    const props = makeProps()
    render(<ContentChrome {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))
    expect(props.onToggleMode).toHaveBeenCalledWith('search')
  })

  it('shows the Personalities chip in prompts mode', () => {
    render(<ContentChrome {...makeProps({ mode: 'prompts' })} />)
    expect(screen.getByText('Personalities')).toBeInTheDocument()
  })

  it('renders success and error alerts and dismisses them', () => {
    const props = makeProps({ statusMsg: 'Saved', error: 'Failed' })
    render(<ContentChrome {...props} />)
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(props.onDismissStatus).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Dismiss error'))
    expect(props.onDismissError).toHaveBeenCalled()
  })

  it('shows an unknown-plugin warning for a bogus plugin id', () => {
    render(<ContentChrome {...makeProps({ activePluginId: 'does-not-exist' })} />)
    expect(screen.getByText('Unknown plugin')).toBeInTheDocument()
  })
})
