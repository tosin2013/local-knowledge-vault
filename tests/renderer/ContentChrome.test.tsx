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
    onNewDraft: vi.fn(),
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

  it('orders the primary toggle Ask → Find → Study with accessible names', () => {
    render(<ContentChrome {...makeProps()} />)
    const group = screen.getByRole('group', { name: 'Primary mode' })
    const buttons = Array.from(group.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))
    expect(buttons).toEqual(['Ask', 'Find', 'Study'])
    expect(screen.getByRole('button', { name: 'Ask' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Study' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('switches to Study and marks it pressed in study mode', () => {
    const props = makeProps()
    const { rerender } = render(<ContentChrome {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Study' }))
    expect(props.onToggleMode).toHaveBeenCalledWith('study')
    rerender(<ContentChrome {...props} mode="study" />)
    expect(screen.getByRole('button', { name: 'Study' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Ask' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('reaches every primary tab by keyboard', () => {
    render(<ContentChrome {...makeProps()} />)
    for (const name of ['Ask', 'Find', 'Study']) {
      const b = screen.getByRole('button', { name })
      b.focus()
      expect(b).toHaveFocus()
    }
  })

  it('leaves no tab pressed while an add-on is open, so Ask returns home', () => {
    const props = makeProps({ activePluginId: 'media-chat' })
    render(<ContentChrome {...props} />)
    expect(screen.getByRole('button', { name: 'Ask' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(props.onToggleMode).toHaveBeenCalledWith('chat')
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

  it('announces status (polite) and errors (assertive) to screen readers', () => {
    render(<ContentChrome {...makeProps({ statusMsg: 'Saved', error: 'Failed' })} />)
    expect(screen.getByText('Saved').closest('[role="status"]')).toBeInTheDocument()
    expect(screen.getByText('Failed').closest('[role="alert"]')).toBeInTheDocument()
  })

  it('shows an unknown-plugin warning for a bogus plugin id', () => {
    render(<ContentChrome {...makeProps({ activePluginId: 'does-not-exist' })} />)
    expect(screen.getByText('Unknown plugin')).toBeInTheDocument()
  })
})
