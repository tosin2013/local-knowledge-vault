import type { ComponentType } from 'react'

/** Lightweight plugin descriptor for Vault's plugin menu. */
export type VaultPlugin = {
  id: string
  name: string
  description: string
  icon?: string
  /** React view rendered when the plugin is opened from the menu. */
  render: ComponentType<VaultPluginRenderProps>
}

export type VaultPluginRenderProps = {
  /** Open a note peek without leaving the plugin (Ask-home pattern). */
  onOpenNote?: (id: string) => void
  /** Optional: leave plugin and return to Ask. */
  onClose?: () => void
}
