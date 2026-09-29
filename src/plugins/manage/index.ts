import type { VaultPlugin } from '../types'
import { ManagePluginsView } from './ManagePluginsView'

export const MANAGE_PLUGINS_ID = 'manage-plugins'

export const managePluginsPlugin: VaultPlugin = {
  id: MANAGE_PLUGINS_ID,
  name: 'Add-ons',
  description: 'Add AI providers, answer styles and connections.',
  icon: 'extension',
  render: ManagePluginsView,
}
