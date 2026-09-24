import type { VaultPlugin } from '../types'
import { McpConnectionsView } from './McpConnectionsView'

export const mcpConnectionsPlugin: VaultPlugin = {
  id: 'mcp-connections',
  name: 'MCP connections',
  description:
    'Connect Notion and other remote MCP servers from Vault (OAuth + Streamable HTTP).',
  icon: 'hub',
  render: McpConnectionsView,
}
