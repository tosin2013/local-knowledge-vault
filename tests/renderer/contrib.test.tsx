import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import {
  notifyPluginsChanged,
  PluginMcpPresetsSection,
  PluginPersonasSection,
  usePluginContributions,
} from '../../src/plugins/contrib'

describe('usePluginContributions', () => {
  it('loads contributions from window.lkv', async () => {
    const lkv = window.lkv as any
    lkv.plugins.contributions.mockResolvedValue({
      providers: [],
      personas: [],
      promptPacks: [],
      mcpServers: [],
    })
    const { result } = renderHook(() => usePluginContributions())
    await waitFor(() => expect(result.current).toEqual({ providers: [], personas: [], promptPacks: [], mcpServers: [] }))
  })

  it('falls back to empty on error', async () => {
    const lkv = window.lkv as any
    lkv.plugins.contributions.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => usePluginContributions())
    await waitFor(() => expect(result.current.personas).toEqual([]))
  })
})

describe('PluginPersonasSection', () => {
  it('renders nothing when there are no personas', () => {
    render(<PluginPersonasSection />)
    expect(screen.queryByText('From plugins')).not.toBeInTheDocument()
  })

  it('renders a persona and installs it', async () => {
    const lkv = window.lkv as any
    lkv.plugins.contributions.mockResolvedValue({
      providers: [],
      personas: [{ name: 'Sage', prompt: 'Be wise', description: 'wise', pluginId: 'p1', pluginName: 'Pack' }],
      promptPacks: [],
      mcpServers: [],
    })
    lkv.media.createPersona.mockResolvedValue({ promptId: 'prm_1', name: 'Sage' })
    const onInstalled = vi.fn()
    render(<PluginPersonasSection onInstalled={onInstalled} />)

    await screen.findByText('Sage')
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    await waitFor(() => expect(lkv.media.createPersona).toHaveBeenCalled())
    await waitFor(() => expect(onInstalled).toHaveBeenCalledWith('Sage'))
  })

  it('surfaces install errors', async () => {
    const lkv = window.lkv as any
    lkv.plugins.contributions.mockResolvedValue({
      providers: [],
      personas: [{ name: 'Sage', prompt: 'Be wise', pluginId: 'p1', pluginName: 'Pack' }],
      promptPacks: [],
      mcpServers: [],
    })
    lkv.media.createPersona.mockRejectedValue(new Error('nope'))
    render(<PluginPersonasSection />)

    await screen.findByText('Sage')
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    await waitFor(() => expect(screen.getByText('nope')).toBeInTheDocument())
  })
})

describe('PluginMcpPresetsSection', () => {
  it('renders nothing without MCP presets', () => {
    render(<PluginMcpPresetsSection existingUrls={[]} onAdded={vi.fn()} onError={vi.fn()} />)
    expect(screen.queryByText('Suggested by plugins')).not.toBeInTheDocument()
  })

  it('renders presets and adds one', async () => {
    const lkv = window.lkv as any
    lkv.plugins.contributions.mockResolvedValue({
      providers: [],
      personas: [],
      promptPacks: [],
      mcpServers: [{ name: 'Notion', url: 'https://mcp.notion.com/mcp', pluginId: 'p1', pluginName: 'Pack' }],
    })
    const onAdded = vi.fn()
    render(<PluginMcpPresetsSection existingUrls={[]} onAdded={onAdded} onError={vi.fn()} />)

    await screen.findByText('Notion')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(lkv.mcp.addServer).toHaveBeenCalledWith({ name: 'Notion', url: 'https://mcp.notion.com/mcp' }))
    await waitFor(() => expect(onAdded).toHaveBeenCalled())
  })

  it('disables Add for already-added presets', async () => {
    const lkv = window.lkv as any
    lkv.plugins.contributions.mockResolvedValue({
      providers: [],
      personas: [],
      promptPacks: [],
      mcpServers: [{ name: 'Notion', url: 'https://mcp.notion.com/mcp', pluginId: 'p1', pluginName: 'Pack' }],
    })
    render(<PluginMcpPresetsSection existingUrls={['https://mcp.notion.com/mcp']} onAdded={vi.fn()} onError={vi.fn()} />)

    await screen.findByText('Notion')
    expect(screen.getByRole('button', { name: 'Added' })).toBeDisabled()
  })
})
