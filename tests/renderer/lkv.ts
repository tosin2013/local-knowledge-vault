import { vi } from 'vitest'
import type {
  AskGroundedResult,
  ChatMessage,
  ChatProfile,
  ChatSession,
  CitationPackExportResult,
  ImportFromUrlResult,
  Item,
  LlmStatus,
  McpServerSummary,
  McpToolSummary,
  MediaIngestResult,
  MediaProjectInfo,
  MediaVoicePackInfo,
  PluginInfo,
  PluginListResult,
  ProviderConfig,
  ProviderPresetInfo,
  Prompt,
  SearchHit,
} from '../../electron/types'

export function makeItem(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    title: 'Note title',
    summary: null,
    body: 'Note body',
    para: 'resources',
    kind: 'note',
    status: 'active',
    project: null,
    created_at: '2026-09-28T00:00:00.000Z',
    updated_at: '2026-09-28T00:00:00.000Z',
    ...overrides,
  }
}

export function makeHit(id: string, overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    id,
    title: 'Hit title',
    snippet: 'A snippet',
    score: 0.9,
    para: 'resources',
    kind: 'note',
    project: null,
    ...overrides,
  }
}

export function makeSession(id: string, title = 'New chat', overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id,
    title,
    mode: 'grounded',
    filters_json: null,
    created_at: '2026-09-28T00:00:00.000Z',
    updated_at: '2026-09-28T00:00:00.000Z',
    ...overrides,
  }
}

export function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg_1',
    session_id: 's_1',
    role: 'assistant',
    content: 'Hello [itm_1]',
    citations_json: JSON.stringify([{ id: 'itm_1', title: 'Note title' }]),
    hits_json: null,
    created_at: '2026-09-28T00:00:00.000Z',
    ...overrides,
  }
}

export function makePrompt(id: string, name = 'Grounded default', body = 'Be grounded'): Prompt {
  return {
    id,
    name,
    body,
    description: null,
    created_at: '2026-09-28T00:00:00.000Z',
    updated_at: '2026-09-28T00:00:00.000Z',
  }
}

export function makeProfile(id: string, overrides: Partial<ChatProfile> = {}): ChatProfile {
  return {
    id,
    name: 'My profile',
    prompt_id: 'prm_1',
    project: 'Work',
    created_at: '2026-09-28T00:00:00.000Z',
    updated_at: '2026-09-28T00:00:00.000Z',
    ...overrides,
  }
}

export function makeProvider(id: string, overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id,
    kind: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434',
    model: '',
    hasKey: false,
    requiresKey: false,
    local: true,
    enabled: true,
    source: 'builtin',
    ...overrides,
  }
}

export function makePreset(id: string, overrides: Partial<ProviderPresetInfo> = {}): ProviderPresetInfo {
  return {
    id,
    kind: 'openai-compatible',
    label: id === 'custom' ? 'Custom (OpenAI-compatible)' : 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: '',
    local: false,
    requiresKey: true,
    supportsModelList: false,
    ...overrides,
  }
}

export function makeLlmStatus(overrides: Partial<LlmStatus> = {}): LlmStatus {
  return {
    selected: 'auto',
    active: null,
    message: 'AI offline — search still works',
    providers: [],
    needsSetup: false,
    recommendedLocalModel: {
      name: 'qwen3:8b',
      command: 'ollama pull qwen3:8b',
      why: 'Small (~5 GB) and good at following citation rules.',
    },
    ...overrides,
  }
}

export function makeAskResult(overrides: Partial<AskGroundedResult> = {}): AskGroundedResult {
  return {
    answer: 'An answer',
    citations: [{ id: 'itm_1', title: 'Note title' }],
    hits: [makeHit('itm_1')],
    ...overrides,
  }
}

export function makeImportResult(overrides: Partial<ImportFromUrlResult> = {}): ImportFromUrlResult {
  return {
    item: makeItem('itm_imported', { title: 'Imported note', para: 'resources', kind: 'article' }),
    tagsSource: 'heuristic',
    ...overrides,
  }
}

export function makeCitationPackResult(overrides: Partial<CitationPackExportResult> = {}): CitationPackExportResult {
  return {
    path: '/tmp/pack',
    noteCount: 2,
    missingCount: 0,
    ...overrides,
  }
}

export function makeMediaProject(project = 'My podcast', overrides: Partial<MediaProjectInfo> = {}): MediaProjectInfo {
  return {
    project,
    noteCount: 10,
    sourceType: 'local',
    mediaProtocolUrl: `lkvmedia://${project}`,
    updatedAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  }
}

export function makeVoicePack(promptId: string, name = 'Desk cohost', overrides: Partial<MediaVoicePackInfo> = {}): MediaVoicePackInfo {
  return {
    name,
    promptId,
    description: 'Media voice pack',
    builtin: true,
    ...overrides,
  }
}

export function makeIngestResult(overrides: Partial<MediaIngestResult> = {}): MediaIngestResult {
  return {
    project: 'My podcast',
    title: 'My podcast',
    noteCount: 10,
    itemIds: ['itm_1'],
    promptId: 'prm_media_reader',
    profileId: 'prf_1',
    sourceType: 'local',
    mediaPath: '/tmp/audio.mp3',
    mediaProtocolUrl: 'lkvmedia://audio',
    ...overrides,
  }
}

export function makeMcpServer(id: string, overrides: Partial<McpServerSummary> = {}): McpServerSummary {
  return {
    id,
    name: 'Mock MCP',
    url: 'https://example.com/mcp',
    status: 'disconnected',
    preset: null,
    ...overrides,
  }
}

export function makeMcpTool(name: string, overrides: Partial<McpToolSummary> = {}): McpToolSummary {
  return { name, description: 'A tool', ...overrides }
}

export function makePluginInfo(id: string, overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    id,
    name: id,
    version: '1.0.0',
    description: 'A declarative plugin',
    source: 'installed',
    enabled: true,
    contributes: ['2 providers'],
    ...overrides,
  }
}

export function makePluginListResult(overrides: Partial<PluginListResult> = {}): PluginListResult {
  return {
    plugins: [],
    errors: [],
    pluginsDir: '/tmp/plugins',
    disabled: [],
    ...overrides,
  }
}

export interface LkvMock {
  [key: string]: unknown
}

/** A full window.lkv stub. Every method resolves to a benign default; override per-test. */
export function createLkvMock(): LkvMock {
  return {
    items: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation((input: { title: string }) =>
        Promise.resolve(makeItem('itm_new', { title: input.title })),
      ),
      get: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation((id: string) => Promise.resolve(makeItem(id))),
      delete: vi.fn().mockResolvedValue(true),
    },
    search: {
      query: vi.fn().mockResolvedValue({ hits: [] }),
    },
    ask: {
      grounded: vi.fn().mockResolvedValue(makeAskResult()),
    },
    llm: {
      status: vi.fn().mockResolvedValue(makeLlmStatus()),
    },
    providers: {
      list: vi.fn().mockResolvedValue({ providers: [], selected: 'auto', presets: [] }),
      setSelected: vi.fn().mockResolvedValue('auto'),
      setEnabled: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(makeProvider('ollama')),
      remove: vi.fn().mockResolvedValue(true),
      test: vi.fn().mockResolvedValue({ ok: true }),
      fetchModels: vi.fn().mockResolvedValue({ models: [] }),
    },
    plugins: {
      list: vi.fn().mockResolvedValue({ plugins: [], errors: [], pluginsDir: '', disabled: [] }),
      reload: vi.fn().mockResolvedValue({ plugins: [], errors: [], pluginsDir: '', disabled: [] }),
      setEnabled: vi.fn().mockResolvedValue({ plugins: [], errors: [], pluginsDir: '', disabled: [] }),
      remove: vi.fn().mockResolvedValue({ plugins: [], errors: [], pluginsDir: '', disabled: [] }),
      install: vi.fn().mockResolvedValue({ ok: true }),
      openFolder: vi.fn().mockResolvedValue({ path: '' }),
      contributions: vi
        .fn()
        .mockResolvedValue({ providers: [], personas: [], promptPacks: [], mcpServers: [] }),
    },
    app: {
      openExternal: vi.fn().mockResolvedValue(true),
    },
    chat: {
      listSessions: vi.fn().mockResolvedValue([]),
      createSession: vi.fn().mockResolvedValue(makeSession('s_1')),
      getSession: vi.fn().mockResolvedValue(null),
      deleteSession: vi.fn().mockResolvedValue(true),
      updateSessionTitle: vi.fn().mockResolvedValue(null),
      listMessages: vi.fn().mockResolvedValue([]),
      send: vi.fn().mockResolvedValue({
        assistant: makeMessage(),
        messages: [makeMessage()],
        session: makeSession('s_1'),
        offline: false,
      }),
    },
    import: {
      fromUrl: vi.fn().mockResolvedValue(makeImportResult()),
    },
    prompts: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((input: { name: string; body: string }) =>
        Promise.resolve(makePrompt('prm_new', input.name, input.body)),
      ),
      update: vi.fn().mockImplementation((id: string, patch: { name?: string; body?: string }) =>
        Promise.resolve(makePrompt(id, patch.name ?? 'n', patch.body ?? 'b')),
      ),
      delete: vi.fn().mockResolvedValue(true),
    },
    profiles: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((input: { name: string; promptId: string; project?: string }) =>
        Promise.resolve(makeProfile('prf_new', { name: input.name, prompt_id: input.promptId, project: input.project ?? '' })),
      ),
      update: vi.fn().mockImplementation((id: string, patch: { name?: string }) =>
        Promise.resolve(makeProfile(id, patch)),
      ),
      delete: vi.fn().mockResolvedValue(true),
    },
    citationPack: {
      export: vi.fn().mockResolvedValue(makeCitationPackResult()),
    },
    bridge: {
      status: vi.fn().mockResolvedValue({ running: true, host: '127.0.0.1', port: 8765, version: '1.0.0' }),
      getToken: vi.fn().mockResolvedValue('test-token'),
      rotateToken: vi.fn().mockResolvedValue('test-token'),
    },
    media: {
      pickLocal: vi.fn().mockResolvedValue({ canceled: true }),
      ingestLocal: vi.fn().mockResolvedValue(makeIngestResult()),
      ingestYoutube: vi.fn().mockResolvedValue(makeIngestResult({ sourceType: 'youtube' })),
      listProjects: vi.fn().mockResolvedValue([]),
      notesNear: vi.fn().mockResolvedValue([]),
      youtubeEmbedUrl: vi.fn().mockResolvedValue(null),
      ensurePersonas: vi.fn().mockResolvedValue({ promptIds: [], names: [], created: [], updated: [] }),
      applyPersona: vi.fn().mockResolvedValue({
        promptId: 'prm_1',
        profileId: 'prf_1',
        personaName: 'Desk cohost',
        profileName: 'Desk cohost · My podcast',
      }),
      createPersona: vi.fn().mockImplementation((input: { name: string }) =>
        Promise.resolve({ promptId: 'prm_new', name: input.name }),
      ),
      listVoicePacks: vi.fn().mockResolvedValue([]),
    },
    mcp: {
      listServers: vi.fn().mockResolvedValue([]),
      addServer: vi.fn().mockImplementation((input: { name: string; url: string }) =>
        Promise.resolve(makeMcpServer('mcp_1', { name: input.name, url: input.url })),
      ),
      ensureNotion: vi.fn().mockResolvedValue(makeMcpServer('notion', { preset: 'notion', name: 'Notion' })),
      removeServer: vi.fn().mockResolvedValue(true),
      connect: vi.fn().mockResolvedValue({ server: makeMcpServer('mcp_1', { status: 'connected' }), tools: [] }),
      disconnect: vi.fn().mockResolvedValue(makeMcpServer('mcp_1', { status: 'disconnected' })),
      cancelAuth: vi.fn().mockResolvedValue(null),
      listTools: vi.fn().mockResolvedValue([]),
    },
  }
}

/** Installs the given (or a fresh) lkv mock onto window and returns it. */
export function installLkv(mock?: LkvMock): LkvMock {
  const lkv = mock ?? createLkvMock()
  Object.defineProperty(window, 'lkv', { value: lkv, configurable: true, writable: true })
  return lkv
}
