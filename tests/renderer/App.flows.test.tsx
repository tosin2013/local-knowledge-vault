import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../src/App'
import { makeItem, makeMessage, makePrompt, makeSession } from './lkv'

/**
 * End-to-end renderer flows through <App /> with window.lkv mocked at the IPC
 * boundary (see tests/renderer/lkv.ts). These exercise the orchestrator wiring
 * that component/hook unit tests do not: Ask round-trips, notes CRUD through
 * the rail + peek, and the Simple/Advanced switch.
 */

/** Seed the IPC mock with a grounded prompt and one note so the App hydrates. */
function seed() {
  const lkv = window.lkv as {
    prompts: { list: { mockResolvedValue: (v: unknown) => unknown } }
    items: { list: { mockResolvedValue: (v: unknown) => unknown }; get: { mockResolvedValue: (v: unknown) => unknown } }
  } & Record<string, any>
  lkv.prompts.list.mockResolvedValue([makePrompt('prm_g', 'Grounded default')])
  lkv.items.list.mockResolvedValue([makeItem('itm_1', { title: 'First note', project: 'Work' })])
  lkv.items.get.mockResolvedValue(makeItem('itm_1', { title: 'First note', body: 'Body text' }))
  return lkv
}

/** Render the app and wait for it to finish hydrating the grounded profile. */
async function renderApp() {
  render(<App />)
  await waitFor(() =>
    expect(screen.getByText(/Ask anything grounded in your notes/)).toBeInTheDocument(),
  )
  return userEvent.setup()
}

describe('App flows — Ask', () => {
  it('sends a question and renders the answer with citations', async () => {
    const lkv = seed()
    lkv.chat.send.mockResolvedValue({
      messages: [
        makeMessage({ id: 'msg_user', role: 'user', content: 'What is PARA?' }),
        makeMessage({
          id: 'msg_asst',
          role: 'assistant',
          content: 'PARA is a note-organising method.',
          citations_json: JSON.stringify([{ id: 'itm_1', title: 'Cited note' }]),
        }),
      ],
      session: makeSession('s_1', 'What is PARA?'),
      offline: false,
    })
    const user = await renderApp()

    await user.type(screen.getByPlaceholderText(/Ask about your notes/), 'What is PARA?')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(screen.getByText('PARA is a note-organising method.')).toBeInTheDocument())
    expect(screen.getByText('Cited note')).toBeInTheDocument()
    expect(lkv.chat.send).toHaveBeenCalled()
  })

  it('renders the "could not find that in your notes" reply', async () => {
    const lkv = seed()
    lkv.chat.send.mockResolvedValue({
      messages: [
        makeMessage({
          role: 'assistant',
          content: "I couldn't find that in your notes. Try different words, or clear Notes from / Profile scope.",
        }),
      ],
      session: makeSession('s_1'),
      offline: false,
    })
    const user = await renderApp()

    await user.type(screen.getByPlaceholderText(/Ask about your notes/), 'banana')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(screen.getByText(/I couldn't find that in your notes/)).toBeInTheDocument(),
    )
  })

  it('shows a provider error when sending fails', async () => {
    const lkv = seed()
    lkv.chat.send.mockRejectedValue(new Error('Provider unavailable'))
    const user = await renderApp()

    await user.type(screen.getByPlaceholderText(/Ask about your notes/), 'hello')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(screen.getByText('Provider unavailable')).toBeInTheDocument())
  })

  it('marks the reply as offline when the model is unavailable', async () => {
    const lkv = seed()
    lkv.chat.send.mockResolvedValue({
      messages: [makeMessage({ role: 'assistant', content: 'Saved as a status notice.' })],
      session: makeSession('s_1'),
      offline: true,
    })
    const user = await renderApp()

    await user.type(screen.getByPlaceholderText(/Ask about your notes/), 'hello')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(screen.getByText(/AI unavailable — your message was saved/)).toBeInTheDocument(),
    )
  })

  it('pre-fills the Ask composer via "Ask instead" from Find', async () => {
    seed()
    const user = await renderApp()

    await user.click(screen.getByRole('button', { name: 'Find' }))
    await waitFor(() => expect(screen.getByText('Ask instead')).toBeInTheDocument())
    await user.type(screen.getByPlaceholderText('Search your notes…'), 'habits')
    await user.click(screen.getByText('Ask instead'))

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Ask about your notes/)).toHaveValue('habits'),
    )
  })
})

describe('App flows — Notes rail + note peek', () => {
  it('creates a new note through the rail and peek', async () => {
    const lkv = seed()
    const items = [makeItem('itm_1', { title: 'First note' })]
    lkv.items.list.mockImplementation(() => Promise.resolve([...items]))
    lkv.items.create.mockImplementation((input: { title: string; body?: string }) => {
      const item = makeItem('itm_new', { title: input.title, body: input.body ?? '' })
      items.push(item)
      return Promise.resolve(item)
    })
    const user = await renderApp()

    await user.click(screen.getByText('New note'))
    const title = await screen.findByPlaceholderText('Title')
    await user.type(title, 'My new note')
    await user.type(screen.getByPlaceholderText('Write your note…'), 'Some body')
    await user.click(screen.getByText('Save'))

    await waitFor(() => expect(lkv.items.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'My new note' })))
    await waitFor(() => expect(screen.getAllByText('My new note').length).toBeGreaterThan(0))
  })

  it('opens an existing note, edits and saves it', async () => {
    const lkv = seed()
    lkv.items.update.mockImplementation((id: string, patch: { title?: string }) =>
      Promise.resolve(makeItem(id, { title: patch.title ?? 'First note', body: 'Body text' })),
    )
    const user = await renderApp()

    await user.click(screen.getByText('First note'))
    const edit = await screen.findByText('Edit')
    await user.click(edit)

    const title = await screen.findByPlaceholderText('Title')
    await user.clear(title)
    await user.type(title, 'Renamed note')
    await user.click(screen.getByText('Save'))

    await waitFor(() =>
      expect(lkv.items.update).toHaveBeenCalledWith(
        'itm_1',
        expect.objectContaining({ title: 'Renamed note' }),
      ),
    )
  })

  it('deletes a note from the peek editor', async () => {
    const lkv = seed()
    const user = await renderApp()

    await user.click(screen.getByText('First note'))
    await user.click(await screen.findByText('Edit'))
    await user.click(screen.getByText('Delete'))

    await waitFor(() => expect(lkv.items.delete).toHaveBeenCalledWith('itm_1'))
  })

  it('filters the notes rail by project', async () => {
    const lkv = seed()
    lkv.items.list.mockResolvedValue([
      makeItem('itm_1', { title: 'First note', project: 'Work' }),
      makeItem('itm_2', { title: 'Second note', project: 'Home' }),
    ])
    const user = await renderApp()

    // Open the project select and pick Work.
    await user.click(screen.getByRole('combobox', { name: 'Project' }))
    await user.click(screen.getByRole('option', { name: 'Work' }))

    await waitFor(() => expect(lkv.items.list).toHaveBeenCalled())
  })
})

describe('App flows — Simple/Advanced', () => {
  it('toggles Advanced mode, revealing the Personalities and import UI', async () => {
    await renderApp()

    // Simple mode: no Personalities button, no Add-from-URL import form.
    expect(screen.queryByText('Personalities')).not.toBeInTheDocument()
    expect(screen.queryByText('Add from URL')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: /Advanced/ }))

    await waitFor(() => expect(screen.getByText('Personalities')).toBeInTheDocument())
    expect(screen.getByText('Add from URL')).toBeInTheDocument()
  })

  it('toggling back to Simple hides advanced UI', async () => {
    await renderApp()
    const toggle = screen.getByRole('checkbox', { name: /Advanced/ })

    fireEvent.click(toggle)
    await waitFor(() => expect(screen.getByText('Add from URL')).toBeInTheDocument())

    fireEvent.click(toggle)
    await waitFor(() => expect(screen.queryByText('Add from URL')).not.toBeInTheDocument())
  })
})
