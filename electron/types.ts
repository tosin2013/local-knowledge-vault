/** Shared types for Local Knowledge Vault IPC and domain models */

export type Para = 'projects' | 'areas' | 'resources' | 'archives'
export type ItemKind = string
export type ItemStatus = string

/** Application-menu actions sent to the renderer (CmdOrCtrl+N / F / K). */
export type MenuAction = 'new-note' | 'find' | 'ask'

export interface Item {
  id: string
  title: string
  summary: string | null
  body: string
  para: Para
  kind: string
  status: string
  project: string | null
  created_at: string
  updated_at: string
}

export interface ItemFilters {
  para?: Para | ''
  kind?: string
  status?: string
  project?: string
}

/** A first-class project name and how many notes carry it. */
export interface ProjectSummary {
  name: string
  count: number
}

/** Result of a project rename/merge/delete (count of notes affected). */
export interface ProjectResult {
  count: number
}

export interface CreateItemInput {
  title: string
  body?: string
  para?: Para
  kind?: string
  status?: string
  project?: string | null
  summary?: string | null
}

export interface UpdateItemPatch {
  title?: string
  body?: string
  para?: Para
  kind?: string
  status?: string
  project?: string | null
  summary?: string | null
}

export interface SearchHit {
  id: string
  title: string
  snippet: string
  score: number
  para: Para
  kind: string
  project: string | null
}

export interface SearchQueryInput {
  text: string
  filters?: ItemFilters
  limit?: number
  /** When true, transcript (source) chunks sort after the user's own notes. */
  sourcesLast?: boolean
}

export interface SearchQueryResult {
  hits: SearchHit[]
}

export interface Citation {
  id: string
  title: string
  /** Project/source the cited note belongs to (for traceability in chips). */
  project?: string | null
}

export interface AskGroundedInput {
  question: string
  filters?: ItemFilters
  limit?: number
  systemExtra?: string
  /** When true, transcript (source) chunks sort after the user's own notes. */
  sourcesLast?: boolean
}

export interface AskGroundedResult {
  answer: string
  citations: Citation[]
  hits: SearchHit[]
  /** Set when a model produced the answer. */
  provider?: AnswerProvider
  offline?: boolean
  error?: string
}

export interface OllamaHealth {
  ok: boolean
  models?: string[]
  /** parameter_size per model when Ollama reports it (e.g. "8.2B"). */
  modelSizes?: Record<string, string>
  error?: string
}

export interface ListItemsInput {
  filters?: ItemFilters
}

/* ---- Chat sessions / messages ---- */

export type ChatMode = 'grounded' | 'brainstorm'
export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatSession {
  id: string
  title: string
  mode: ChatMode
  filters_json: string | null
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: string
  session_id: string
  role: ChatRole
  content: string
  citations_json: string | null
  hits_json: string | null
  /** JSON AnswerProvider for model-written assistant messages (#45). */
  provider_json: string | null
  created_at: string
}

export interface CreateSessionInput {
  title?: string
  mode?: ChatMode
  filters?: ItemFilters
}

export interface ChatSendInput {
  sessionId: string
  text: string
  filters?: ItemFilters
  promptId?: string
  systemPrompt?: string
  limit?: number
  /** When true, transcript (source) chunks sort after the user's own notes. */
  sourcesLast?: boolean
}

export interface ChatSendResult {
  assistant: ChatMessage
  messages: ChatMessage[]
  session: ChatSession
  offline?: boolean
  error?: string
}

/* ---- Prompts ---- */

export interface Prompt {
  id: string
  name: string
  body: string
  description: string | null
  created_at: string
  updated_at: string
}

export interface CreatePromptInput {
  name: string
  body: string
  description?: string | null
}

export interface UpdatePromptPatch {
  name?: string
  body?: string
  description?: string | null
}


/* ---- LLM providers (renderer-safe; API keys NEVER cross IPC — only hasKey) ---- */

/** Transport family. 'gemini' uses Google's official OpenAI-compatible endpoint. */
export type ProviderKind = 'ollama' | 'openai-compatible' | 'anthropic' | 'gemini'
export type ProviderSource = 'builtin' | 'user' | 'plugin'
/**
 * 'auto' = local-first resolution, then enabled cloud providers;
 * 'auto-local' = the same, but never a cloud provider (#45);
 * otherwise a provider id.
 */
export type ProviderSelection = 'auto' | 'auto-local' | string

/** Which provider produced an answer, so the UI can flag cloud answers (#45). */
export interface AnswerProvider {
  id: string
  label: string
  model: string
  /** False when the question and note passages left this computer. */
  local: boolean
  /** True when Auto picked a cloud provider (no local model answered). */
  fallback: boolean
}

export interface ProviderHealth {
  ok: boolean
  /** Installed / listed models (local: installed models). */
  models?: string[]
  /** Ollama parameter sizes when reported, keyed by model name (e.g. "1.2B"). */
  modelSizes?: Record<string, string>
  error?: string
  /** True when health was not probed (cloud: we don't ping on every status poll). */
  skipped?: boolean
}

export interface ProviderConfig {
  id: string
  kind: ProviderKind
  label: string
  baseUrl: string
  /** Empty for local providers = auto-pick an installed model. */
  model: string
  hasKey: boolean
  /** Key required to call (cloud) vs optional (local / custom). */
  requiresKey: boolean
  local: boolean
  enabled: boolean
  source: ProviderSource
  /** Preset this came from (openai, groq, lmstudio, custom …). */
  presetId?: string
  /** Plugin id when source === 'plugin'. */
  pluginId?: string
  /** Where the key lives (env var name or 'file'), never the key itself. */
  keySource?: 'env' | 'file' | null
  health?: ProviderHealth
}

export interface ProviderPresetInfo {
  id: string
  kind: ProviderKind
  label: string
  baseUrl: string
  defaultModel: string
  local: boolean
  requiresKey: boolean
  /** GET {baseUrl}/models works (Fetch models button). */
  supportsModelList: boolean
  docsUrl?: string
  keyUrl?: string
  notes?: string
  /** Plugin-contributed presets. */
  pluginId?: string
}

export interface ActiveProviderInfo {
  id: string
  label: string
  kind: ProviderKind
  local: boolean
  model: string
  /** Detected local model looks tiny (<3B params) — show a gentle hint. */
  smallModel?: boolean
}

export interface LlmStatus {
  selected: ProviderSelection
  active: ActiveProviderInfo | null
  message: string
  providers: ProviderConfig[]
  /** Nothing local detected and no cloud provider enabled → show first-run card. */
  needsSetup: boolean
  /** Recommended local model for the first-run card. */
  recommendedLocalModel: { name: string; command: string; why: string }
}

export interface ProviderDraft {
  /** Existing id when editing; omitted when adding. */
  id?: string
  presetId?: string
  kind: ProviderKind
  label: string
  baseUrl: string
  model: string
  local?: boolean
  enabled?: boolean
  /** undefined = keep existing key; '' or null = clear; string = set. */
  apiKey?: string | null
}

export interface ProviderTestResult {
  ok: boolean
  latencyMs: number
  model?: string
  sample?: string
  error?: string
}

export interface ProviderModelsResult {
  ok: boolean
  models: string[]
  error?: string
}

/* ---- Declarative plugins (plugin.json, no code execution) ---- */

export interface PluginProviderPreset {
  id: string
  label: string
  kind: 'openai-compatible' | 'anthropic' | 'ollama' | 'gemini'
  baseUrl: string
  defaultModel: string
  local?: boolean
  requiresKey?: boolean
  docsUrl?: string
  notes?: string
}

export interface PluginPersona {
  name: string
  /** Voice / style text; Vault wraps it in the fixed grounding rules. */
  prompt: string
  description?: string
}

export interface PluginPromptPack {
  name: string
  prompts: string[]
}

export interface PluginMcpServerPreset {
  name: string
  url: string
  description?: string
}

export interface PluginManifest {
  schemaVersion: 1
  id: string
  name: string
  version: string
  description?: string
  author?: string
  homepage?: string
  contributes: {
    providers?: PluginProviderPreset[]
    personas?: PluginPersona[]
    promptPacks?: PluginPromptPack[]
    mcpServers?: PluginMcpServerPreset[]
  }
}

export interface PluginInfo {
  id: string
  name: string
  version: string
  description: string
  author?: string
  source: 'builtin' | 'installed'
  enabled: boolean
  /** Folder on disk (installed only). */
  dir?: string
  /** Short summary like ["2 providers", "1 persona"]. */
  contributes: string[]
  manifest?: PluginManifest
  /** data: URL of icon.png when shipped (≤ 256 KB). */
  iconDataUrl?: string
}

export interface PluginLoadError {
  /** Folder name under plugins/ */
  folder: string
  dir: string
  errors: string[]
}

export interface PluginListResult {
  /** Installed (declarative) plugins. Built-in panels come from the renderer registry. */
  plugins: PluginInfo[]
  errors: PluginLoadError[]
  pluginsDir: string
  /** Disabled plugin ids (installed or built-in). */
  disabled: string[]
}

export interface PluginInstallResult {
  ok: boolean
  canceled?: boolean
  plugin?: PluginInfo
  errors?: string[]
  /** Non-fatal notes (e.g. skipped non-asset files, replaced older version). */
  warnings?: string[]
}

export interface PluginContributions {
  providers: Array<PluginProviderPreset & { pluginId: string }>
  personas: Array<PluginPersona & { pluginId: string; pluginName: string }>
  promptPacks: Array<PluginPromptPack & { pluginId: string; pluginName: string }>
  mcpServers: Array<PluginMcpServerPreset & { pluginId: string; pluginName: string }>
}

/* ---- Add-on install preview / removed (recoverable) plugins ---- */

export interface PluginCloudProvider {
  label: string
  domain: string
}

/** A pre-install preview of what an add-on contributes, in plain language. */
export interface PluginPreview {
  id: string
  name: string
  version: string
  description: string
  author?: string
  /** Plain-language "what it adds" strings, e.g. ["2 cloud AI providers", "1 voice"]. */
  adds: string[]
  /** Cloud (non-local) providers with their domains — surfaced for install consent. */
  cloudProviders: PluginCloudProvider[]
  /** Local (non-cloud) provider labels, if any. */
  localProviders: string[]
  /** Filesystem path to install from (bundled or user-picked). */
  sourcePath: string
}

export interface PluginPreviewResult {
  canceled?: boolean
  preview?: PluginPreview
  errors?: string[]
}

export interface RemovedPlugin {
  /** Directory name under plugins-removed/ (stable restore key). */
  key: string
  id: string
  name: string
  version: string
}

/* ---- Import from URL ---- */

export interface ImportFromUrlResult {
  item: Item
  tagsSource: 'llm' | 'heuristic'
  warning?: string
}

/* ---- Import Markdown / Obsidian notes from a folder ---- */

export interface MarkdownImportResult {
  /** True when the user cancelled the folder picker. */
  canceled?: boolean
  imported: number
  skipped: number
  /** Ids of the notes that were created (in walk order). */
  itemIds: string[]
  /** Per-file human-readable problems (empty files are silent, not listed). */
  errors: string[]
}


/* ---- Chat profiles (user-saved Personality + Project) ---- */

export interface ChatProfile {
  id: string
  name: string
  prompt_id: string
  project: string
  created_at: string
  updated_at: string
}

export interface CreateChatProfileInput {
  name: string
  promptId: string
  project?: string
}

export interface UpdateChatProfilePatch {
  name?: string
  promptId?: string
  project?: string
}

/* ---- Citation pack export ---- */

export interface CitationPackExportInput {
  sessionId: string
  /** Optional profile label for manifest.profileHint */
  profileHint?: string
}

export interface CitationPackExportResult {
  canceled?: boolean
  path?: string
  zipPath?: string
  folderPath?: string
  noteCount?: number
  missingCount?: number
}

/* ---- Media chat ingest ---- */

export interface MediaIngestLocalInput {
  mediaPath: string
  captionsPath: string
  project?: string
  replaceExisting?: boolean
}

export interface MediaIngestYoutubeInput {
  url: string
  project?: string
  replaceExisting?: boolean
}

export interface MediaIngestResult {
  project: string
  title: string
  noteCount: number
  itemIds: string[]
  promptId: string
  profileId: string
  sourceType: 'local' | 'youtube'
  mediaPath?: string
  mediaUrl?: string
  mediaProtocolUrl?: string
}

/** Progress event emitted from main → renderer while a media ingest runs (#128). */
export interface MediaIngestProgress {
  stage: string
  noteCount?: number
}

export interface MediaProjectInfo {
  project: string
  noteCount: number
  sourceType: 'local' | 'youtube' | 'unknown'
  mediaPath?: string
  mediaUrl?: string
  mediaProtocolUrl?: string
  updatedAt: string
}

export interface MediaFindExistingInput {
  mediaPath?: string
  url?: string
}

export interface MediaExistingProject {
  project: string
  noteCount: number
}

export interface MediaPickLocalResult {
  canceled: boolean
  mediaPath?: string
  captionsPath?: string
  companionCaptionsFound?: boolean
}

export interface MediaNotesNearInput {
  project: string
  centerSec: number
  windowSec?: number
}

/* ---- Media personas ---- */

export interface MediaApplyPersonaInput {
  /** Persona name ("Desk cohost"), id ("desk-cohost"), or custom Easy Add voice-pack name */
  persona: string
  project: string
  displayTitle?: string
}

export interface MediaApplyPersonaResult {
  promptId: string
  profileId: string
  personaName: string
  profileName: string
}

export interface MediaEnsurePersonasResult {
  promptIds: string[]
  names: string[]
  created: string[]
  updated: string[]
}

export interface MediaCreatePersonaInput {
  name: string
  speakingStyle: string
  description?: string | null
}

export interface MediaCreatePersonaResult {
  promptId: string
  name: string
}

export interface MediaVoicePackInfo {
  name: string
  promptId: string
  description: string
  builtin: boolean
  speakingStyle?: string
}

export interface BridgeAskInput {
  text: string
  project?: string
  promptId?: string
}

export interface BridgeAskResult {
  answer: string
  citations: Citation[]
  /** Which provider wrote the answer, so bridge clients can flag cloud answers (#45). */
  provider?: AnswerProvider
}

/* ---- Update notice (#42) ---- */

export interface UpdateSettings {
  /** Ask GitHub for the latest release once per launch. */
  checkOnLaunch: boolean
}

export type UpdateCheckResult =
  | {
      ok: true
      current: string
      updateAvailable: boolean
      /** Latest released version; absent when the check was skipped. */
      latest?: string
      /** Release page for `latest`. */
      url?: string
      /** Why no request was made (launch check only). */
      skipped?: 'disabled' | 'development' | 'snap'
    }
  | { ok: false; current: string; error: string }

/* ---- MCP connections (in-app MCP client) ---- */

export type McpServerStatus = 'disconnected' | 'connected' | 'needs_auth' | 'authorizing' | 'error'

export interface McpServerSummary {
  id: string
  name: string
  url: string
  status: McpServerStatus
  toolCount?: number
  error?: string
  /** Identity from token response when available */
  workspaceId?: string
  userId?: string
  emailDomain?: string
  preset?: 'notion' | null
}

export interface McpToolSummary {
  name: string
  description?: string
}

export interface McpAddServerInput {
  name: string
  url: string
}

export interface McpConnectResult {
  server: McpServerSummary
  tools: McpToolSummary[]
}

export interface McpCallToolInput {
  id: string
  name: string
  args?: Record<string, unknown>
}

export interface McpCallToolResult {
  content: unknown
  isError?: boolean
}
