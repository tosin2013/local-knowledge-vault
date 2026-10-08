import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('opens the Study tab in Simple mode and switches sections (#260)', async () => {
    render(<App />)
    const study = await screen.findByRole('button', { name: 'Study' })
    expect(document.querySelector('.app.ui-simple')).not.toBeNull()
    fireEvent.click(study)
    expect(await screen.findByTestId('study-tab')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Study' })).toHaveAttribute('aria-pressed', 'true')
    // Study opens on Study home (#262).
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByTestId('study-home')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Import practice test' }))
    expect(await screen.findByRole('heading', { name: 'Import practice test' })).toBeInTheDocument()
    // Back to Ask, then Study again keeps the last section.
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.queryByTestId('study-tab')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Study' }))
    expect(await screen.findByRole('tab', { name: 'Import practice test' })).toHaveAttribute('aria-selected', 'true')
  })

  it('no longer lists Study, Review or Test to notes under Plugins', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Plugins' }))
    expect(await screen.findByRole('menuitem', { name: /^Media chat/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^MCP connections/ })).toBeInTheDocument()
    for (const name of [/^Study/, /^Review/, /^Test to notes/]) {
      expect(screen.queryByRole('menuitem', { name })).not.toBeInTheDocument()
    }
  })

  it('ignores stale disabled-plugin ids for the former add-ons', async () => {
    const lkv = window.lkv as unknown as { plugins: { list: ReturnType<typeof vi.fn> } }
    lkv.plugins.list.mockResolvedValue({
      plugins: [],
      errors: [],
      pluginsDir: '',
      disabled: ['study', 'review', 'test-to-notes'],
    })
    render(<App />)
    await waitFor(() => expect(lkv.plugins.list).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button', { name: 'Study' }))
    expect(await screen.findByTestId('study-tab')).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(4)
  })

  it('handles the new-note menu action (⌘N)', async () => {
    let handler: ((action: string) => void) | undefined
    const lkv = window.lkv as unknown as {
      app: { onMenuAction: ReturnType<typeof vi.fn> }
    }
    lkv.app.onMenuAction.mockImplementation((cb: (action: string) => void) => {
      handler = cb
      return () => {}
    })
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Find' })).toBeInTheDocument())
    expect(handler).toBeDefined()
    act(() => handler!('new-note'))
    await waitFor(() => expect(screen.getByLabelText('Note title')).toBeInTheDocument())
  })
})
