/** Shared types for Local Knowledge Vault IPC and domain models */

export type Para = 'projects' | 'areas' | 'resources' | 'archives'
export type ItemKind = string
export type ItemStatus = string

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
}

export interface SearchQueryResult {
  hits: SearchHit[]
}

export interface Citation {
  id: string
  title: string
}

export interface AskGroundedInput {
  question: string
  filters?: ItemFilters
  limit?: number
  systemExtra?: string
}

export interface AskGroundedResult {
  answer: string
  citations: Citation[]
  hits: SearchHit[]
  offline?: boolean
  error?: string
}

export interface OllamaHealth {
  ok: boolean
  models?: string[]
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


/* ---- LLM provider settings (renderer-safe; no API key) ---- */
/* Grok = xAI. Groq = GroqCloud. Distinct vendors — label clearly in UI. */

export type LlmProviderChoice = 'auto' | 'ollama' | 'grok' | 'groq'
export type LlmProviderId = 'ollama' | 'grok' | 'groq'

export interface LlmSettingsPatch {
  provider?: LlmProviderChoice
  grokEnabled?: boolean
  grokModel?: string
  groqEnabled?: boolean
  groqModel?: string
}

export interface LlmSettingsPublic {
  provider: LlmProviderChoice
  grokEnabled: boolean
  grokModel: string
  groqEnabled: boolean
  groqModel: string
  /** xAI Grok key present */
  hasKey: boolean
  /** GroqCloud key present */
  hasGroqKey: boolean
}

export interface GrokHealth {
  ok: boolean
  models?: string[]
  error?: string
  hasKey: boolean
}

export interface GroqHealth {
  ok: boolean
  models?: string[]
  error?: string
  hasKey: boolean
}

export interface LlmStatus {
  ollama: OllamaHealth
  grok: GrokHealth
  groq: GroqHealth
  active: LlmProviderId | null
  message: string
}

/* ---- Import from URL ---- */

export interface ImportFromUrlResult {
  item: Item
  tagsSource: 'llm' | 'heuristic'
  warning?: string
}


/* ---- Chat profiles (user-saved Personality + Notes from) ---- */

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
  /** If set, write pack folder (+ zip) here without a dialog. */
  outputDir?: string
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

export interface MediaProjectInfo {
  project: string
  noteCount: number
  sourceType: 'local' | 'youtube' | 'unknown'
  mediaPath?: string
  mediaUrl?: string
  mediaProtocolUrl?: string
  updatedAt: string
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
}

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
