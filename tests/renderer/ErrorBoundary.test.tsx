import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '../../src/components/ErrorBoundary'

function Bomb(): React.ReactElement {
  throw new Error('kaboom')
}

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div>hello</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('shows a fallback instead of blanking when a child throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>,
      )
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText(/kaboom/)).toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
  })
})
