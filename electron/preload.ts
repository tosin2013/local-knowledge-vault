/**
 * Preload — contextBridge API for renderer.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type {
  AskGroundedInput,
  AskGroundedResult,
  BookImportResult,
  ChatMessage,
  ChatProfile,
  ChatSendInput,
  ChatSendResult,
  ChatSession,
  CitationPackExportInput,
  CitationPackExportResult,
  CreateChatProfileInput,
  CreateItemInput,
  MediaIngestLocalInput,
  MediaIngestProgress,
  MediaIngestResult,
  MediaIngestYoutubeInput,
  MediaNotesNearInput,
  MediaPickLocalResult,
  MediaProjectInfo,
  MediaApplyPersonaInput,
  MediaApplyPersonaResult,
  MediaEnsurePersonasResult,
  MediaCreatePersonaInput,
  MediaCreatePersonaResult,
  MediaVoicePackInfo,
  MediaFindExistingInput,
  MediaExistingProject,
  McpAddServerInput,
  McpCallToolInput,
  McpCallToolResult,
  McpConnectResult,
  McpServerSummary,
  McpToolSummary,
  MenuAction,
  UpdateCheckResult,
  UpdateSettings,
  CreatePromptInput,
  CreateSessionInput,
  ImportFromUrlResult,
  Item,
  ListItemsInput,
  LlmStatus,
  MarkdownImportResult,
  PluginContributions,
  PluginInstallResult,
  PluginListResult,
  PluginPreview,
  PluginPreviewResult,
  ProviderConfig,
  ProviderDraft,
  ProviderModelsResult,
  ProviderPresetInfo,
  ProviderSelection,
  ProviderTestResult,
  ProjectResult,
  ProjectSummary,
  RemovedPlugin,
  OllamaHealth,
  PersonalityExportInput,
  PersonalityExportResult,
  PersonalityImportResult,
  PersonalityPreviewInput,
  PersonalityPreviewResult,
  Prompt,
  ReviewEnqueueInput,
  ReviewQueueItem,
  ReviewRateInput,
  ReviewState,
  SearchQueryInput,
  SearchQueryResult,
  StudyAttempt,
  StudyAttemptInput,
  StudyCalibration,
  TestToNotesAnalyzeInput,
  TestToNotesSuggestion,
  UpdateChatProfilePatch,
  UpdateItemPatch,
  UpdatePromptPatch,
} from './types'

const api = {
  items: {
    list: (input?: ListItemsInput): Promise<Item[]> =>
      ipcRenderer.invoke('items:list', input),
    create: (input: CreateItemInput): Promise<Item> =>
      ipcRenderer.invoke('items:create', input),
    get: (id: string): Promise<Item | null> => ipcRenderer.invoke('items:get', id),
    update: (id: string, patch: UpdateItemPatch): Promise<Item | null> =>
      ipcRenderer.invoke('items:update', id, patch),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('items:delete', id),
    trash: (id: string): Promise<boolean> => ipcRenderer.invoke('items:trash', id),
    restore: (id: string): Promise<boolean> => ipcRenderer.invoke('items:restore', id),
    listTrashed: (): Promise<Item[]> => ipcRenderer.invoke('items:listTrashed'),
    emptyTrash: (): Promise<number> => ipcRenderer.invoke('items:emptyTrash'),
    listSamples: (): Promise<Item[]> => ipcRenderer.invoke('items:listSamples'),
    removeSamples: (): Promise<number> => ipcRenderer.invoke('items:removeSamples'),
    count: (): Promise<number> => ipcRenderer.invoke('items:count'),
  },
  search: {
    query: (input: SearchQueryInput): Promise<SearchQueryResult> =>
      ipcRenderer.invoke('search:query', input),
  },
  ask: {
    grounded: (input: AskGroundedInput): Promise<AskGroundedResult> =>
      ipcRenderer.invoke('ask:grounded', input),
  },
  testToNotes: {
    analyze: (input: TestToNotesAnalyzeInput): Promise<TestToNotesSuggestion[]> =>
      ipcRenderer.invoke('testToNotes:analyze', input),
  },
  review: {
    listDue: (input?: { before?: string; limit?: number }): Promise<ReviewQueueItem[]> =>
      ipcRenderer.invoke('review:listDue', input),
    count: (input?: { before?: string }): Promise<number> =>
      ipcRenderer.invoke('review:count', input),
    rate: (input: ReviewRateInput): Promise<ReviewState> =>
      ipcRenderer.invoke('review:rate', input),
    enqueue: (input: ReviewEnqueueInput): Promise<ReviewState> =>
      ipcRenderer.invoke('review:enqueue', input),
    remove: (itemId: string): Promise<boolean> => ipcRenderer.invoke('review:remove', itemId),
  },
  study: {
    record: (input: StudyAttemptInput): Promise<StudyAttempt> =>
      ipcRenderer.invoke('study:record', input),
    listRecent: (limit?: number): Promise<StudyAttempt[]> =>
      ipcRenderer.invoke('study:listRecent', limit),
    calibration: (): Promise<StudyCalibration> =>
      ipcRenderer.invoke('study:calibration'),
  },
  },
  ollama: {
    health: (): Promise<OllamaHealth> => ipcRenderer.invoke('ollama:health'),
  },
  llm: {
    status: (): Promise<LlmStatus> => ipcRenderer.invoke('llm:status'),
  },
  providers: {
    list: (): Promise<{
      providers: ProviderConfig[]
      selected: ProviderSelection
      presets: ProviderPresetInfo[]
    }> => ipcRenderer.invoke('providers:list'),
    setSelected: (sel: ProviderSelection): Promise<ProviderSelection> =>
      ipcRenderer.invoke('providers:setSelected', sel),
    setEnabled: (id: string, enabled: boolean): Promise<ProviderConfig[]> =>
      ipcRenderer.invoke('providers:setEnabled', id, enabled),
    /** apiKey is write-only: sent to main, stored locally, never returned. */
    save: (draft: ProviderDraft): Promise<ProviderConfig> => ipcRenderer.invoke('providers:save', draft),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('providers:remove', id),
    test: (draft: ProviderDraft): Promise<ProviderTestResult> => ipcRenderer.invoke('providers:test', draft),
    fetchModels: (draft: ProviderDraft): Promise<ProviderModelsResult> =>
      ipcRenderer.invoke('providers:fetchModels', draft),
  },
  plugins: {
    list: (): Promise<PluginListResult> => ipcRenderer.invoke('plugins:list'),
    reload: (): Promise<PluginListResult> => ipcRenderer.invoke('plugins:reload'),
    setEnabled: (id: string, enabled: boolean): Promise<PluginListResult> =>
      ipcRenderer.invoke('plugins:setEnabled', id, enabled),
    remove: (id: string): Promise<PluginListResult> => ipcRenderer.invoke('plugins:remove', id),
    install: (kind?: 'folder' | 'zip'): Promise<PluginInstallResult> =>
      ipcRenderer.invoke('plugins:install', kind),
    preview: (kind?: 'folder' | 'zip'): Promise<PluginPreviewResult> =>
      ipcRenderer.invoke('plugins:preview', kind),
    installFromPath: (srcPath: string): Promise<PluginInstallResult> =>
      ipcRenderer.invoke('plugins:installFromPath', srcPath),
    listRemoved: (): Promise<RemovedPlugin[]> => ipcRenderer.invoke('plugins:listRemoved'),
    restore: (key: string): Promise<PluginListResult> => ipcRenderer.invoke('plugins:restore', key),
    listBundled: (): Promise<PluginPreview[]> => ipcRenderer.invoke('plugins:listBundled'),
    openFolder: (): Promise<{ path: string; error?: string }> => ipcRenderer.invoke('plugins:openFolder'),
    contributions: (): Promise<PluginContributions> => ipcRenderer.invoke('plugins:contributions'),
  },
  app: {
    openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('app:openExternal', url),
    onMenuAction: (callback: (action: MenuAction) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, action: MenuAction) => callback(action)
      ipcRenderer.on('menu:action', listener)
      return () => ipcRenderer.removeListener('menu:action', listener)
    },
  },
  chat: {
    listSessions: (): Promise<ChatSession[]> => ipcRenderer.invoke('chat:listSessions'),
    createSession: (input?: CreateSessionInput): Promise<ChatSession> =>
      ipcRenderer.invoke('chat:createSession', input),
    getSession: (id: string): Promise<ChatSession | null> =>
      ipcRenderer.invoke('chat:getSession', id),
    deleteSession: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('chat:deleteSession', id),
    updateSessionTitle: (id: string, title: string): Promise<ChatSession | null> =>
      ipcRenderer.invoke('chat:updateSessionTitle', id, title),
    listMessages: (sessionId: string): Promise<ChatMessage[]> =>
      ipcRenderer.invoke('chat:listMessages', sessionId),
    send: (input: ChatSendInput): Promise<ChatSendResult> =>
      ipcRenderer.invoke('chat:send', input),
  },
  import: {
    fromUrl: (url: string): Promise<ImportFromUrlResult> =>
      ipcRenderer.invoke('import:fromUrl', url),
    fromMarkdown: (): Promise<MarkdownImportResult> =>
      ipcRenderer.invoke('import:markdown'),
    fromBook: (): Promise<BookImportResult> => ipcRenderer.invoke('import:book'),
  },
  prompts: {
    list: (): Promise<Prompt[]> => ipcRenderer.invoke('prompts:list'),
    get: (id: string): Promise<Prompt | null> => ipcRenderer.invoke('prompts:get', id),
    create: (input: CreatePromptInput): Promise<Prompt> =>
      ipcRenderer.invoke('prompts:create', input),
    update: (id: string, patch: UpdatePromptPatch): Promise<Prompt | null> =>
      ipcRenderer.invoke('prompts:update', id, patch),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('prompts:delete', id),
    export: (input: PersonalityExportInput): Promise<PersonalityExportResult> =>
      ipcRenderer.invoke('prompts:export', input),
    import: (): Promise<PersonalityImportResult> => ipcRenderer.invoke('prompts:import'),
    preview: (input: PersonalityPreviewInput): Promise<PersonalityPreviewResult> =>
      ipcRenderer.invoke('prompts:preview', input),
  },
  profiles: {
    list: (): Promise<ChatProfile[]> => ipcRenderer.invoke('profiles:list'),
    get: (id: string): Promise<ChatProfile | null> =>
      ipcRenderer.invoke('profiles:get', id),
    create: (input: CreateChatProfileInput): Promise<ChatProfile> =>
      ipcRenderer.invoke('profiles:create', input),
    update: (id: string, patch: UpdateChatProfilePatch): Promise<ChatProfile | null> =>
      ipcRenderer.invoke('profiles:update', id, patch),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('profiles:delete', id),
  },
  projects: {
    list: (): Promise<ProjectSummary[]> => ipcRenderer.invoke('projects:list'),
    rename: (from: string, to: string): Promise<ProjectResult> =>
      ipcRenderer.invoke('projects:rename', from, to),
    merge: (from: string, into: string): Promise<ProjectResult> =>
      ipcRenderer.invoke('projects:merge', from, into),
    delete: (name: string): Promise<ProjectResult> =>
      ipcRenderer.invoke('projects:delete', name),
  },
  citationPack: {
    export: (input: CitationPackExportInput): Promise<CitationPackExportResult> =>
      ipcRenderer.invoke('citationPack:export', input),
  },
  media: {
    pickLocal: (): Promise<MediaPickLocalResult> =>
      ipcRenderer.invoke('media:pickLocal'),
    ingestLocal: (input: MediaIngestLocalInput): Promise<MediaIngestResult> =>
      ipcRenderer.invoke('media:ingestLocal', input),
    ingestYoutube: (input: MediaIngestYoutubeInput): Promise<MediaIngestResult> =>
      ipcRenderer.invoke('media:ingestYoutube', input),
    listProjects: (): Promise<MediaProjectInfo[]> =>
      ipcRenderer.invoke('media:listProjects'),
    findExistingProject: (input: MediaFindExistingInput): Promise<MediaExistingProject | null> =>
      ipcRenderer.invoke('media:findExistingProject', input),
    notesNear: (input: MediaNotesNearInput): Promise<Item[]> =>
      ipcRenderer.invoke('media:notesNear', input),
    youtubeEmbedUrl: (url: string): Promise<string | null> =>
      ipcRenderer.invoke('media:youtubeEmbedUrl', url),
    ensurePersonas: (): Promise<MediaEnsurePersonasResult> =>
      ipcRenderer.invoke('media:ensurePersonas'),
    applyPersona: (input: MediaApplyPersonaInput): Promise<MediaApplyPersonaResult> =>
      ipcRenderer.invoke('media:applyPersona', input),
    createPersona: (input: MediaCreatePersonaInput): Promise<MediaCreatePersonaResult> =>
      ipcRenderer.invoke('media:createPersona', input),
    listVoicePacks: (): Promise<MediaVoicePackInfo[]> =>
      ipcRenderer.invoke('media:listVoicePacks'),
    onIngestProgress: (callback: (progress: MediaIngestProgress) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, progress: MediaIngestProgress) =>
        callback(progress)
      ipcRenderer.on('media:ingestProgress', listener)
      return () => ipcRenderer.removeListener('media:ingestProgress', listener)
    },
    cancelIngest: (): Promise<boolean> => ipcRenderer.invoke('media:cancelIngest'),
  },
  updates: {
    /** Launch check: honors the setting and skips dev builds and the snap. */
    checkOnLaunch: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('updates:checkOnLaunch'),
    /** Manual "Check now": always asks GitHub. */
    check: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('updates:check'),
    getSettings: (): Promise<UpdateSettings> => ipcRenderer.invoke('updates:getSettings'),
    setSettings: (patch: Partial<UpdateSettings>): Promise<UpdateSettings> =>
      ipcRenderer.invoke('updates:setSettings', patch),
  },
  bridge: {
    status: (): Promise<{ running: boolean; host: string; port: number; version: string }> =>
      ipcRenderer.invoke('bridge:status'),
    getToken: (): Promise<string> => ipcRenderer.invoke('bridge:getToken'),
    rotateToken: (): Promise<string> => ipcRenderer.invoke('bridge:rotateToken'),
  },
  mcp: {
    listServers: (): Promise<McpServerSummary[]> => ipcRenderer.invoke('mcp:listServers'),
    addServer: (input: McpAddServerInput): Promise<McpServerSummary> =>
      ipcRenderer.invoke('mcp:addServer', input),
    ensureNotion: (): Promise<McpServerSummary> => ipcRenderer.invoke('mcp:ensureNotion'),
    removeServer: (id: string): Promise<boolean> => ipcRenderer.invoke('mcp:removeServer', id),
    connect: (id: string): Promise<McpConnectResult> => ipcRenderer.invoke('mcp:connect', id),
    disconnect: (id: string): Promise<McpServerSummary> =>
      ipcRenderer.invoke('mcp:disconnect', id),
    cancelAuth: (id: string): Promise<McpServerSummary | null> =>
      ipcRenderer.invoke('mcp:cancelAuth', id),
    listTools: (id: string): Promise<McpToolSummary[]> =>
      ipcRenderer.invoke('mcp:listTools', id),
    callTool: (input: McpCallToolInput): Promise<McpCallToolResult> =>
      ipcRenderer.invoke('mcp:callTool', input),
  },
}

contextBridge.exposeInMainWorld('lkv', api)

export type LkvApi = typeof api
