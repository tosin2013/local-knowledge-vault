import type { VaultPlugin } from '../types'
import { ManagePluginsView } from './ManagePluginsView'

export const MANAGE_PLUGINS_ID = 'manage-plugins'

export const managePluginsPlugin: VaultPlugin = {
  id: MANAGE_PLUGINS_ID,
  name: 'Manage plugins',
  description: 'Install, enable or remove plugins (plugin.json packs and built-in panels).',
  icon: 'extension',
  render: ManagePluginsView,
}
