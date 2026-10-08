import type { VaultPlugin } from './types'
import { mediaChatPlugin } from './media-chat'
import { mediaPersonasPlugin } from './media-personas'
import { mcpConnectionsPlugin } from './mcp-connections'
import { managePluginsPlugin } from './manage'

/**
 * Lightweight registry for built-in (code) panels.
 * Add a panel: implement VaultPlugin, then push it into `plugins` below.
 * The header Plugins menu reads this list automatically (minus ones the user disabled
 * in Manage plugins). Third-party plugins are declarative plugin.json packs — see
 * docs/plugins-authoring.md; they never run code.
 *
 * Study, Review and Test to notes are not add-ons any more: they live in the
 * top-level Study tab (src/features/study, #260).
 */
export const plugins: VaultPlugin[] = [mediaChatPlugin, mediaPersonasPlugin, mcpConnectionsPlugin]

/** System panels: always available, not listed as toggleable plugins. */
const systemPlugins: VaultPlugin[] = [managePluginsPlugin]

export function getPlugin(id: string): VaultPlugin | undefined {
  return plugins.find((p) => p.id === id) ?? systemPlugins.find((p) => p.id === id)
}

export function listPlugins(): VaultPlugin[] {
  return plugins.slice()
}
