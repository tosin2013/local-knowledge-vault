import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App from '../../src/App'

describe('App', () => {
  it('shows the Electron fallback when the preload API is missing', () => {
    delete (window as unknown as Record<string, unknown>).lkv
    render(<App />)
    expect(screen.getByText(/Run inside Electron/)).toBeInTheDocument()
  })

  it('renders the full shell with the preload API present', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Vault')).toBeInTheDocument())
    expect(screen.getByText('New note')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Find' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument()
    // Chat empty state (grounded-helper default)
    expect(screen.getByText(/Ask anything grounded in your notes/)).toBeInTheDocument()
  })

  it('switches to Find mode and back', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Find' })).toBeInTheDocument())
    screen.getByRole('button', { name: 'Find' }).click()
    await waitFor(() => expect(screen.getByText(/Search to find notes/)).toBeInTheDocument())
  })
})
