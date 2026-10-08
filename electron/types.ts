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
  /** Full matching chunk text (when a long note matched at chunk level). */
  passage?: string
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
  /** True when the answer has substance but cites nothing (#235): a UI warning, never stored text. */
  uncited?: boolean
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
  /** True when the answer had substance but cited nothing (#235). Metadata only; never in `content`. */
  uncited: boolean
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

/** A portable, versioned personality export (#164). Validated on import. */
export interface PersonalityPack {
  kind: 'vault.personality'
  version: number
  name: string
  description: string | null
  body: string
  exportedAt: string
}

export interface PersonalityExportInput {
  id: string
  /** 'file' writes a `.json` via a save dialog; 'clipboard' copies the JSON text. */
  target?: 'file' | 'clipboard'
}

export interface PersonalityExportResult {
  canceled?: boolean
  target?: 'file' | 'clipboard'
  /** Absolute path of the written file (target: 'file' only). */
  path?: string
  name?: string
  error?: string
}

export interface PersonalityImportResult {
  canceled?: boolean
  prompt?: Prompt
  error?: string
}

export interface PersonalityPreviewInput {
  question: string
  /** Draft instructions. Empty means "no personality" (plain grounded answer). */
  body?: string
  filters?: ItemFilters
  /** Also run the answer without the personality and return it for comparison. */
  compare?: boolean
}

export interface PersonalityPreviewResult {
  answer: string
  citations: Citation[]
  offline?: boolean
  error?: string
  defaultAnswer?: string
  defaultCitations?: Citation[]
  defaultOffline?: boolean
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
  /** How API keys and the bridge token are saved on this computer (#237). Set by llm:status. */
  keyStorage?: 'encrypted' | 'plaintext'
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

/* ---- Import local books / PDFs (#162) ---- */

export interface BookImportResult {
  canceled?: boolean
  format?: 'epub' | 'pdf'
  project?: string
  imported: number
  skipped: number
  emptyPages?: number
  /** Repeated header/footer/banner lines dropped from the PDF (debug aid). */
  removedLines?: number
  itemIds: string[]
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

/* ---- Test to notes (#166) ---- */

/** One parsed practice-test item: the question, what the learner answered, and if it was right. */
export interface TestToNotesItem {
  question: string
  answer: string
  correct: boolean
}

export interface TestToNotesAnalyzeInput {
  items: TestToNotesItem[]
  filters?: ItemFilters
  limit?: number
}

export interface TestToNotesParseInput {
  /** Raw pasted practice-test results, in any format. */
  text: string
}

/** The result of AI-parsing pasted test results (heuristic fallback when offline). */
export interface TestToNotesParseResult {
  items: TestToNotesItem[]
  /** True when the AI path failed and the heuristic parser was used instead. */
  offline?: boolean
  error?: string
}

/** A grounded corrective note for one wrong answer, ready for the user to review and save. */
export interface TestToNotesSuggestion {
  question: string
  yourAnswer: string
  title: string
  body: string
  citations: Citation[]
  /** True when the corrective note has substance but cites nothing (#235). */
  uncited?: boolean
  /** True when no model could be reached (body is friendly fallback copy). */
  offline?: boolean
  error?: string
}

/* ---- Spaced review scheduling (#216) ---- */

/** How well the learner recalled an item. SM-2-style four-button scale. */
export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy'

/** The mutable scheduling state for one card. */
export interface ReviewState {
  intervalDays: number
  ease: number
  reps: number
  lapses: number
}

/* ---- Study cards (#259 card model, docs/adr/0004-study-cards.md) ---- */

/** Where a card came from. Practice-test (#265) and reverse (#273) arrive in Phase 2. */
export type StudyCardOrigin = 'note' | 'practice-test' | 'reverse'

/** `pending` cards (e.g. linked to an unconfirmed draft) are not scheduled yet. */
export type StudyCardStatus = 'active' | 'pending' | 'suspended' | 'retired'

/** One study card: the unit that is reviewed and scheduled. */
export interface StudyCard {
  id: string
  /** The note the card belongs to; its project is the card's project. */
  itemId: string
  /** null = the whole note; otherwise the `note_chunks` index. */
  chunkIndex: number | null
  /** Fingerprint of the chunk (or whole note) text the card was made from. */
  chunkHash: string | null
  /** Fingerprint of the note body when the card was made. */
  noteHash: string | null
  origin: StudyCardOrigin
  /** Generated or imported question; null until #263 generates one. */
  question: string | null
  answer: string | null
  /** Exact supporting quote from the note. */
  quote: string | null
  /** Practice-test cards: the source test's name and date (#265). */
  sourceTest: string | null
  sourceTestDate: string | null
  /** Unique idempotency key, e.g. `note:itm_…#2`. */
  sourceKey: string
  /** Higher = more important; lower-priority cards come later in a session. */
  priority: number
  status: StudyCardStatus
  createdAt: string
  updatedAt: string
}

/** A card that is due for review: the note's fields plus the card and its schedule. */
export interface ReviewQueueItem extends Item {
  card_id: string
  /** null = whole-note card. */
  chunk_index: number | null
  /** How many chunks the note has (for "part 2 of 5"). */
  chunk_count: number
  /** The text revealed for this card: the chunk, or the whole note body. */
  card_text: string
  origin: StudyCardOrigin
  question: string | null
  answer: string | null
  quote: string | null
  due_at: string
  interval_days: number
  ease: number
  reps: number
  lapses: number
  last_grade: ReviewGrade | null
  last_reviewed_at: string | null
}

/** One stored card schedule row, without the note body. */
export interface ReviewScheduleRow extends ReviewState {
  cardId: string
  itemId: string
  chunkIndex: number | null
  dueAt: string
  lastGrade: ReviewGrade | null
  lastReviewedAt: string | null
}

export interface ReviewRateInput {
  /** The card being graded. */
  cardId?: string
  /** Legacy: grade the note's first card when no cardId is given. */
  itemId?: string
  grade: ReviewGrade
  /** Optional exam date; anchors the first Good interval (Cepeda-style). */
  targetDate?: string
}

export interface ReviewEnqueueInput {
  itemId: string
  /** Optional exam date; anchors the first Good interval (Cepeda-style). */
  targetDate?: string
}

/** What enrolling a note produced. */
export interface ReviewEnqueueResult {
  /** Cards created now (0 when the note was already enrolled). */
  created: number
  /** Cards the note has in total after the call. */
  cards: number
  alreadyEnrolled: boolean
}

export interface ReviewListInput {
  before?: string
  limit?: number
  /** Optional project filter (exact match). */
  project?: string
}

/* ---- Study mode: recall before reveal (#215) ---- */

/** The learner's own verdict after the answer is revealed. */
export type StudySelfGrade = 'missed' | 'partial' | 'got'

/** What the panel sends when the learner saves an attempt. */
export interface StudyAttemptInput {
  question: string
  /** What the learner recalled before the answer was revealed. */
  attempt?: string
  /** Self-reported confidence, 0–100 (clamped). */
  confidence?: number
  selfGrade: StudySelfGrade
  /** Optional one-line "explain it in your own words". */
  selfExplanation?: string | null
  /** Ids of the cited notes shown as feedback. */
  citedIds?: string[]
  /** The grounded answer text (or fallback copy when offline). */
  answer?: string | null
}

/** One persisted recall attempt plus the feedback it was graded against. */
export interface StudyAttempt {
  id: string
  question: string
  attempt: string
  confidence: number
  self_grade: StudySelfGrade
  self_explanation: string | null
  /** Comma-joined cited note ids. */
  cited_ids: string
  answer: string | null
  created_at: string
}

/**
 * Calibration over a set of attempts: how well confidence tracked accuracy.
 * `bias` = mean confidence − mean accuracy; `brier` is the mean squared error
 * of the confidence (0..1) against the grade score (0..1).
 */
export interface StudyCalibration {
  count: number
  meanConfidence: number
  meanScore: number
  bias: number
  brier: number
}

/* ---- Study mode: generated sample questions ---- */

export interface StudyQuestionsInput {
  /** Optional project to draw questions from. */
  project?: string
  /** How many questions to generate (clamped 1..10). */
  count?: number
}

export interface StudyQuestionsResult {
  questions: string[]
}
