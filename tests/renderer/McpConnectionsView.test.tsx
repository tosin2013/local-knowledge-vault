import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { McpConnectionsView } from '../../src/plugins/mcp-connections/McpConnectionsView'
import { lkvMock, makeMcpServer, makeMcpTool } from './lkv'

describe('McpConnectionsView', () => {
  it('renders the Notion card and connect CTA', async () => {
    render(<McpConnectionsView />)
    expect(screen.getByText('MCP connections')).toBeInTheDocument()
    expect(screen.getByText('Connect Notion')).toBeInTheDocument()
  })

  it('connects Notion', async () => {
    const lkv = lkvMock()
    lkv.mcp.ensureNotion.mockResolvedValue(makeMcpServer('notion', { preset: 'notion', name: 'Notion' }))
    lkv.mcp.connect.mockResolvedValue({
      server: makeMcpServer('notion', { preset: 'notion', status: 'connected', workspaceId: 'ws_123' }),
      tools: [makeMcpTool('search')],
    })
    render(<McpConnectionsView />)

    fireEvent.click(await screen.findByText('Connect Notion'))
    await waitFor(() => expect(lkv.mcp.connect).toHaveBeenCalledWith('notion'))
    await waitFor(() => expect(screen.getByText(/Connected/)).toBeInTheDocument())
  })

  it('shows a failure message when connect rejects', async () => {
    const lkv = lkvMock()
    lkv.mcp.connect.mockRejectedValue(new Error('timed out'))
    render(<McpConnectionsView />)
    fireEvent.click(await screen.findByText('Connect Notion'))
    await waitFor(() => expect(screen.getByText(/Sign-in timed out/)).toBeInTheDocument())
  })

  it('lists another server with Connect / Remove', async () => {
    const lkv = lkvMock()
    lkv.mcp.listServers.mockResolvedValue([makeMcpServer('mcp_1', { name: 'Other', url: 'https://x/mcp' })])
    render(<McpConnectionsView />)
    await screen.findByText('Other')
    expect(screen.getByText('Connect')).toBeInTheDocument()
    expect(screen.getByText('Remove')).toBeInTheDocument()
  })

  it('removes a server', async () => {
    const lkv = lkvMock()
    lkv.mcp.listServers.mockResolvedValue([makeMcpServer('mcp_1', { name: 'Other' })])
    render(<McpConnectionsView />)
    await screen.findByText('Other')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(lkv.mcp.removeServer).toHaveBeenCalledWith('mcp_1'))
  })

  it('adds a server via the dialog', async () => {
    const lkv = lkvMock()
    render(<McpConnectionsView />)
    fireEvent.click(await screen.findByText('Add MCP server'))

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My server' } })
    fireEvent.change(screen.getByLabelText('URL (Streamable HTTP)'), { target: { value: 'https://example.com/mcp' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(lkv.mcp.addServer).toHaveBeenCalledWith({ name: 'My server', url: 'https://example.com/mcp' }),
    )
  })

  it('disconnects a connected server and refreshes its tools', async () => {
    const lkv = lkvMock()
    lkv.mcp.listServers.mockResolvedValue([makeMcpServer('mcp_1', { name: 'Other', status: 'connected' })])
    lkv.mcp.listTools.mockResolvedValue([makeMcpTool('search')])
    render(<McpConnectionsView />)
    await screen.findByText('Other')

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(lkv.mcp.disconnect).toHaveBeenCalledWith('mcp_1'))

    fireEvent.click(screen.getByRole('button', { name: 'Refresh tools' }))
    await waitFor(() => expect(lkv.mcp.listTools).toHaveBeenCalledWith('mcp_1'))
  })
})
