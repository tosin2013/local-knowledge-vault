import type { VaultPlugin } from './types'
import { mediaChatPlugin } from './media-chat'
import { mediaPersonasPlugin } from './media-personas'
import { mcpConnectionsPlugin } from './mcp-connections'

/**
 * Lightweight plugin registry.
 * Add a plugin: implement VaultPlugin, then push it into `plugins` below.
 * The header Plugins menu reads this list automatically.
 */
export const plugins: VaultPlugin[] = [mediaChatPlugin, mediaPersonasPlugin, mcpConnectionsPlugin]

export function getPlugin(id: string): VaultPlugin | undefined {
  return plugins.find((p) => p.id === id)
}

export function listPlugins(): VaultPlugin[] {
  return plugins.slice()
}
