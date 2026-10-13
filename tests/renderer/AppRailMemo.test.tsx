import { describe, expect, it, vi } from 'vitest'
import { memo } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../../src/App'
import type { MenuAction } from '../../electron/types'
import { lkvMock, makeItem } from './lkv'
import type { NotesRailProps } from '../../src/features/NotesRail'
import type { ChatViewProps } from '../../src/features/ChatView'

// Counting spies: the rail is replaced by a probe (its render cost is the 85%
// the issue measures), ChatView wraps the real one in an equivalent memo so the
// count only moves when the real component would re-render (#293).
const counters = vi.hoisted(() => ({ rail: 0, chat: 0 }))

vi.mock('../../src/features/NotesRail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/NotesRail')>()
  const { memo } = await import('react')
  const Probe = memo(function ProbeNotesRail(props: NotesRailProps) {
    counters.rail++
    return <div data-testid="rail-probe" data-notes={props.items.length} />
  })
  return { ...actual, NotesRail: Probe }
})

vi.mock('../../src/features/ChatView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/ChatView')>()
  const Counting = memo(function CountingChatView(props: ChatViewProps) {
    counters.chat++
    return <actual.ChatView {...props} />
  })
  return { ...actual, ChatView: Counting }
})

describe('App keystroke render isolation (#293)', () => {
  it('does not re-render the notes rail for keystrokes elsewhere', async () => {
    const lkv = lkvMock()
    lkv.items.list.mockResolvedValue([makeItem('itm_1'), makeItem('itm_2')])
    lkv.items.count.mockResolvedValue(2)
    let menu: ((action: MenuAction) => void) | undefined
    lkv.app.onMenuAction.mockImplementation((cb: (action: MenuAction) => void) => {
      menu = cb
      return () => {}
    })

    render(<App />)
    await waitFor(() => expect(screen.getByTestId('rail-probe')).toHaveAttribute('data-notes', '2'))
    expect(counters.rail).toBeGreaterThan(0)

    // A keystroke in the Ask composer re-renders ChatView, never the rail.
    counters.rail = 0
    counters.chat = 0
    const composer = await screen.findByPlaceholderText(/Ask about your notes/)
    fireEvent.change(composer, { target: { value: 'x' } })
    await waitFor(() => expect(composer).toHaveValue('x'))
    expect(counters.chat).toBeGreaterThan(0)
    expect(counters.rail).toBe(0)

    // A keystroke in the top-bar search touches neither the rail nor ChatView.
    counters.rail = 0
    counters.chat = 0
    const search = screen.getByPlaceholderText('Find your notes…')
    fireEvent.change(search, { target: { value: 'y' } })
    await waitFor(() => expect(search).toHaveValue('y'))
    expect(counters.rail).toBe(0)
    expect(counters.chat).toBe(0)

    // A keystroke in the note editor touches neither. Opening the note itself
    // legitimately re-renders the rail (the selection changed), so the counter
    // resets after the editor is up, not before.
    await act(async () => {
      menu?.('new-note')
    })
    const title = await screen.findByPlaceholderText('Title')
    counters.rail = 0
    counters.chat = 0
    fireEvent.change(title, { target: { value: 'z' } })
    await waitFor(() => expect(title).toHaveValue('z'))
    expect(counters.rail).toBe(0)
    expect(counters.chat).toBe(0)
  })
})
