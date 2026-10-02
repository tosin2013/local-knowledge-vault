import { describe, expect, it } from 'vitest'
import { describeAdds, cloudDomains } from '../../src/plugins/describe'
import type { PluginManifest } from '../../electron/types'

const manifest = (contributes: PluginManifest['contributes']): PluginManifest => ({
  schemaVersion: 1,
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  contributes,
})

describe('describeAdds', () => {
  it('describes providers, voices, prompt packs and MCP connections', () => {
    const m = manifest({
      providers: [
        { id: 'a', label: 'Cloud A', kind: 'openai-compatible', baseUrl: 'https://a.example.com/api', defaultModel: 'x' },
        { id: 'b', label: 'Local B', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', defaultModel: '', local: true },
      ],
      personas: [{ name: 'Study buddy', prompt: 'Be patient' }],
      promptPacks: [{ name: 'Revision', prompts: ['Quiz me'] }],
      mcpServers: [{ name: 'Notion', url: 'https://mcp.notion.com/mcp' }],
    })
    expect(describeAdds(m)).toEqual([
      '1 local AI provider and 1 cloud AI provider (AI providers)',
      '1 voice (Media chat)',
      '1 prompt pack (Ask)',
      '1 connection (MCP connections)',
    ])
  })
})

describe('cloudDomains', () => {
  it('lists only cloud (non-local) providers with their domains', () => {
    const m = manifest({
      providers: [
        { id: 'a', label: 'Cloud A', kind: 'openai-compatible', baseUrl: 'https://api.example.com/v1', defaultModel: 'x' },
        { id: 'b', label: 'Local', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', defaultModel: '', local: true },
      ],
    })
    expect(cloudDomains(m)).toEqual([{ label: 'Cloud A', domain: 'api.example.com' }])
  })
})
