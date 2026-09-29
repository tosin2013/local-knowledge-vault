import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MediaPersonasView } from '../../src/plugins/media-personas/MediaPersonasView'
import { makeMediaProject, makePrompt, makeVoicePack } from './lkv'

function seed() {
  const lkv = window.lkv as any
  lkv.media.listProjects.mockResolvedValue([makeMediaProject('My podcast')])
  lkv.prompts.list.mockResolvedValue([makePrompt('prm_media_reader', 'Media reader')])
  return lkv
}

describe('MediaPersonasView', () => {
  it('renders the built-in voice packs', async () => {
    seed()
    render(<MediaPersonasView />)
    expect(screen.getByText('Media voices')).toBeInTheDocument()
    expect(screen.getByText('Desk cohost')).toBeInTheDocument()
    expect(screen.getByText('Curious student')).toBeInTheDocument()
    expect(screen.getByText('Skeptical investor')).toBeInTheDocument()
  })

  it('installs / refreshes all personas', async () => {
    const lkv = seed()
    lkv.media.ensurePersonas.mockResolvedValue({
      promptIds: ['prm_1'],
      names: ['Desk cohost'],
      created: ['Desk cohost'],
      updated: [],
    })
    render(<MediaPersonasView />)
    fireEvent.click(await screen.findByText('Install / refresh all'))
    await waitFor(() => expect(lkv.media.ensurePersonas).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText(/Voices ready/)).toBeInTheDocument())
  })

  it('installs one built-in persona', async () => {
    const lkv = seed()
    lkv.media.ensurePersonas.mockResolvedValue({ promptIds: [], names: [], created: [], updated: [] })
    render(<MediaPersonasView />)
    const buttons = await screen.findAllByRole('button', { name: 'Install' })
    fireEvent.click(buttons[0])
    await waitFor(() => expect(lkv.media.ensurePersonas).toHaveBeenCalled())
  })

  it('saves a custom persona via Easy Add', async () => {
    const lkv = seed()
    lkv.media.createPersona.mockResolvedValue({ promptId: 'prm_custom', name: 'Late-night host' })
    render(<MediaPersonasView />)

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Late-night host' } })
    fireEvent.change(screen.getByLabelText(/Short vibe/), { target: { value: 'Warm and wry' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save voice' }))

    await waitFor(() =>
      expect(lkv.media.createPersona).toHaveBeenCalledWith({
        name: 'Late-night host',
        speakingStyle: 'Warm and wry',
        description: undefined,
      }),
    )
  })

  it('disables Save persona until name and style are filled', async () => {
    const lkv = seed()
    render(<MediaPersonasView />)
    expect(screen.getByRole('button', { name: 'Save voice' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'X' } })
    expect(screen.getByRole('button', { name: 'Save voice' })).toBeDisabled()
    expect(lkv.media.createPersona).not.toHaveBeenCalled()
  })

  it('lists custom voice packs', async () => {
    const lkv = seed()
    lkv.media.listVoicePacks.mockResolvedValue([
      makeVoicePack('prm_custom', 'Custom voice', { builtin: false, description: 'My custom voice' }),
    ])
    render(<MediaPersonasView />)
    await screen.findByText('Custom voice')
    expect(screen.getByText('My custom voice')).toBeInTheDocument()
  })

  it('saves an Ask profile for a project', async () => {
    const lkv = seed()
    lkv.media.applyPersona.mockResolvedValue({
      promptId: 'prm_1',
      profileId: 'prf_1',
      personaName: 'Desk cohost',
      profileName: 'Desk cohost · My podcast',
    })
    render(<MediaPersonasView />)

    fireEvent.mouseDown(await screen.findByLabelText('Media project (optional)'))
    fireEvent.click(screen.getByRole('option', { name: /My podcast/ }))
    fireEvent.click(await screen.findByText('Also save Ask profile · Desk cohost'))

    await waitFor(() =>
      expect(lkv.media.applyPersona).toHaveBeenCalledWith({
        persona: 'Desk cohost',
        project: 'My podcast',
        displayTitle: 'My podcast',
      }),
    )
  })
})
