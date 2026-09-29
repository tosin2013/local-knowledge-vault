import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ManagePluginsView } from '../../src/plugins/manage/ManagePluginsView'
import { makePluginInfo, makePluginListResult } from './lkv'

function seedPlugins(overrides: Partial<ReturnType<typeof makePluginListResult>> = {}) {
  const lkv = window.lkv as any
  const result = makePluginListResult(overrides)
  lkv.plugins.list.mockResolvedValue(result)
  return result
}

describe('ManagePluginsView', () => {
  it('renders built-in panels and the manage title', async () => {
    render(<ManagePluginsView />)
    expect(screen.getByText('Manage plugins')).toBeInTheDocument()
    expect(screen.getByText('Media chat')).toBeInTheDocument()
    expect(screen.getByText('Media voices')).toBeInTheDocument()
    expect(screen.getByText('MCP connections')).toBeInTheDocument()
  })

  it('lists installed plugins with contributes chips', async () => {
    seedPlugins({ plugins: [makePluginInfo('p1', { name: 'My pack', contributes: ['2 providers'] })] })
    render(<ManagePluginsView />)
    await screen.findByText('My pack')
    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
  })

  it('shows the empty state when no plugins are installed', async () => {
    seedPlugins()
    render(<ManagePluginsView />)
    await screen.findByText(/No plugins installed yet/)
  })

  it('toggles an installed plugin', async () => {
    seedPlugins({ plugins: [makePluginInfo('p1', { name: 'My pack', enabled: true })] })
    render(<ManagePluginsView />)
    await screen.findByText('My pack')
    fireEvent.click(screen.getByLabelText('Enable My pack'))
    await waitFor(() => expect(window.lkv.plugins.setEnabled).toHaveBeenCalledWith('p1', false))
  })

  it('installs a folder and surfaces install errors', async () => {
    const lkv = window.lkv as any
    lkv.plugins.install.mockResolvedValue({ ok: false, errors: ['bad manifest'] })
    render(<ManagePluginsView />)
    fireEvent.click(screen.getByText('Install folder…'))
    await waitFor(() => expect(lkv.plugins.install).toHaveBeenCalledWith('folder'))
    await waitFor(() => expect(screen.getByText('bad manifest')).toBeInTheDocument())
  })

  it('installs a zip successfully', async () => {
    const lkv = window.lkv as any
    lkv.plugins.install.mockResolvedValue({ ok: true, plugin: makePluginInfo('p1', { name: 'Zipped' }) })
    render(<ManagePluginsView />)
    fireEvent.click(screen.getByText('Install .zip…'))
    await waitFor(() => expect(lkv.plugins.install).toHaveBeenCalledWith('zip'))
  })

  it('reloads and opens the plugins folder', async () => {
    const lkv = window.lkv as any
    render(<ManagePluginsView />)
    fireEvent.click(screen.getByText('Reload'))
    await waitFor(() => expect(lkv.plugins.reload).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Open plugins folder'))
    expect(lkv.plugins.openFolder).toHaveBeenCalled()
  })

  it('removes a plugin after confirm', async () => {
    seedPlugins({ plugins: [makePluginInfo('p1', { name: 'My pack' })] })
    render(<ManagePluginsView />)
    await screen.findByText('My pack')
    fireEvent.click(screen.getByLabelText('Remove My pack'))
    await waitFor(() => expect(window.lkv.plugins.remove).toHaveBeenCalledWith('p1'))
  })

  it('surfaces plugin load errors', async () => {
    seedPlugins({ errors: [{ folder: 'bad-folder', dir: '/tmp/bad-folder', errors: ['no manifest'] }] })
    render(<ManagePluginsView />)
    await screen.findByText(/bad-folder: not loaded/)
    expect(screen.getByText('no manifest')).toBeInTheDocument()
  })
})
