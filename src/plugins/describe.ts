import type { PluginCloudProvider, PluginManifest } from '../../electron/types'

/**
 * Plain-language descriptions of what an add-on contributes, for the
 * Manage-plugins ("Add-ons") screen. Mirrors the main-process preview summary
 * in electron/plugin-loader.ts.
 */

/** "What it adds" strings in plain language, each with its destination in parens. */
export function describeAdds(m: PluginManifest): string[] {
  const out: string[] = []
  const providers = m.contributes.providers ?? []
  const local = providers.filter((p) => p.kind === 'ollama' || p.local).length
  const cloud = providers.length - local
  if (local || cloud) {
    const bits: string[] = []
    if (local) bits.push(`${local} local AI provider${local === 1 ? '' : 's'}`)
    if (cloud) bits.push(`${cloud} cloud AI provider${cloud === 1 ? '' : 's'}`)
    out.push(`${bits.join(' and ')} (AI providers)`)
  }
  const nP = m.contributes.personas?.length ?? 0
  if (nP) out.push(`${nP} voice${nP === 1 ? '' : 's'} (Media chat)`)
  const nPack = m.contributes.promptPacks?.length ?? 0
  if (nPack) out.push(`${nPack} prompt pack${nPack === 1 ? '' : 's'} (Ask)`)
  const nMcp = m.contributes.mcpServers?.length ?? 0
  if (nMcp) out.push(`${nMcp} connection${nMcp === 1 ? '' : 's'} (MCP connections)`)
  return out
}

/** Cloud (non-local) providers with their domains, for the install-consent warning. */
export function cloudDomains(m: PluginManifest): PluginCloudProvider[] {
  const out: PluginCloudProvider[] = []
  for (const p of m.contributes.providers ?? []) {
    if (p.kind === 'ollama' || p.local) continue
    let domain = p.baseUrl
    try {
      domain = new URL(p.baseUrl).host
    } catch {
      /* keep raw baseUrl */
    }
    out.push({ label: p.label, domain })
  }
  return out
}
