import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ManagePluginsView } from '../../src/plugins/manage/ManagePluginsView'
import { makePluginInfo, makePluginListResult } from './lkv'

function seedPlugins(overrides: Partial<ReturnType<typeof makePluginListResult>> = {}) {
  const lkv = window.lkv as any
  const result = makePluginListResult(overrides)
  lkv.plugins.list.mockResolvedValue(result)
  return result
}

const makePreview = (overrides: Record<string, unknown> = {}) => ({
  id: 'demo',
  name: 'Demo add-on',
  version: '1.0.0',
  description: 'A demo add-on',
  author: 'Examples',
  adds: ['2 cloud AI providers (AI providers)', '1 voice (Media chat)'],
  cloudProviders: [{ label: 'OpenRouter', domain: 'openrouter.ai' }],
  localProviders: [],
  sourcePath: '/tmp/demo',
  ...overrides,
})

describe('ManagePluginsView', () => {
  it('renders the Add-ons title and no built-in panels', async () => {
    render(<ManagePluginsView />)
    expect(screen.getByText('Add-ons')).toBeInTheDocument()
    expect(screen.queryByText('Media chat')).not.toBeInTheDocument()
    expect(screen.queryByText('Built-in panels')).not.toBeInTheDocument()
  })

  it('lists installed add-ons with name and version', async () => {
    seedPlugins({ plugins: [makePluginInfo('p1', { name: 'My pack', contributes: ['2 providers'] })] })
    render(<ManagePluginsView />)
    await screen.findByText('My pack')
    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
  })

  it('shows the empty state when no add-ons are installed', async () => {
    seedPlugins()
    render(<ManagePluginsView />)
    await screen.findByText(/No add-ons installed yet/)
  })

  it('toggles an installed add-on', async () => {
    seedPlugins({ plugins: [makePluginInfo('p1', { name: 'My pack', enabled: true })] })
    render(<ManagePluginsView />)
    await screen.findByText('My pack')
    fireEvent.click(screen.getByLabelText('Enable My pack'))
    await waitFor(() => expect(window.lkv.plugins.setEnabled).toHaveBeenCalledWith('p1', false))
  })

  it('removes an add-on after confirm', async () => {
    seedPlugins({ plugins: [makePluginInfo('p1', { name: 'My pack' })] })
    render(<ManagePluginsView />)
    await screen.findByText('My pack')
    fireEvent.click(screen.getByLabelText('Remove My pack'))
    await waitFor(() => expect(window.lkv.plugins.remove).toHaveBeenCalledWith('p1'))
  })

  it('lists bundled add-ons and opens a preview before installing', async () => {
    const lkv = window.lkv as any
    lkv.plugins.listBundled.mockResolvedValue([makePreview()])
    render(<ManagePluginsView />)
    await screen.findByText('Demo add-on')
    expect(screen.getByText('2 cloud AI providers (AI providers)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Install “Demo add-on”?')).toBeInTheDocument()
    // Cloud warning surfaces the domain for consent.
    expect(within(dialog).getByText(/openrouter\.ai/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install' }))
    await waitFor(() => expect(lkv.plugins.installFromPath).toHaveBeenCalledWith('/tmp/demo'))
  })

  it('surfaces preview errors', async () => {
    const lkv = window.lkv as any
    lkv.plugins.preview.mockResolvedValue({ errors: ['bad manifest'] })
    render(<ManagePluginsView />)
    fireEvent.click(screen.getByText('Install add-on…'))
    await waitFor(() => expect(screen.getByText('bad manifest')).toBeInTheDocument())
  })

  it('restores a removed add-on', async () => {
    const lkv = window.lkv as any
    lkv.plugins.listRemoved.mockResolvedValue([{ key: 'demo-123', id: 'demo', name: 'Demo', version: '1.0.0' }])
    render(<ManagePluginsView />)
    await screen.findByText('Removed')
    fireEvent.click(screen.getByText('Restore'))
    await waitFor(() => expect(lkv.plugins.restore).toHaveBeenCalledWith('demo-123'))
  })

  it('surfaces plugin load errors', async () => {
    seedPlugins({ errors: [{ folder: 'bad-folder', dir: '/tmp/bad-folder', errors: ['no manifest'] }] })
    render(<ManagePluginsView />)
    await screen.findByText(/bad-folder: not loaded/)
    expect(screen.getByText('no manifest')).toBeInTheDocument()
  })
})
