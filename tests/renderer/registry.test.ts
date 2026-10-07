import { describe, expect, it } from 'vitest'
import { getPlugin, listPlugins, plugins } from '../../src/plugins/registry'

describe('plugin registry', () => {
  it('lists the six built-in toggleable panels', () => {
    const ids = listPlugins().map((p) => p.id).sort()
    expect(ids).toEqual(['mcp-connections', 'media-chat', 'media-personas', 'review', 'study', 'test-to-notes'])
  })

  it('exposes the raw plugins array', () => {
    expect(plugins.length).toBe(6)
    expect(plugins.every((p) => p.name && p.description && p.render)).toBe(true)
  })

  it('gets a built-in plugin by id', () => {
    expect(getPlugin('media-chat')?.name).toBe('Media chat')
    expect(getPlugin('media-personas')?.name).toBe('Media voices')
  })

  it('gets the manage-plugins system panel', () => {
    expect(getPlugin('manage-plugins')?.name).toBe('Add-ons')
  })

  it('returns undefined for an unknown id', () => {
    expect(getPlugin('does-not-exist')).toBeUndefined()
  })
})
