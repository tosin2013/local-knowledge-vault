/**
 * Electron main process — app lifecycle + IPC handlers.
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, session, shell, type OpenDialogOptions } from 'electron'
import path from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'
import {
  closeDb,
  createChatProfile,
  createItem,
  createPrompt,
  createSession,
  countItems,
  deleteChatProfile,
  deleteItem,
  deletePrompt,
  deleteSession,
  emptyTrash,
  getChatProfile,
  getItem,
  getPrompt,
  getSession,
  initDb,
  listChatProfiles,
  listItems,
  listMessages,
  listPrompts,
  listSessions,
  listProjects,
  listSampleNotes,
  listTrashedItems,
  renameProject,
  mergeProject,
  deleteProject,
  getProjectSettings,
  setProjectExamDate,
  restoreItem,
  removeSampleNotes,
  trashItem,
  updateChatProfile,
  updateItem,
  updatePrompt,
  updateSessionTitle,
  uniquePromptName,
} from './db'
import { searchQuery } from './search'
import { askGrounded } from './generate'
import { parsePersonalityPack, personalityFileName, serializePersonalityPack } from './personality-pack'
import { sendChatTurn } from './chat'
import { analyzeTestResults, parseTestResultsWithAi } from './test-to-notes'
import { listDueReviews, countDueReviews, rateReview, enqueueReview, removeReview, getStudyStats } from './review'
import { enrollProject } from './study-cards'
import { listRecentAttempts, recordStudyAttempt, studyCalibration } from './study'
import { generateStudyQuestions } from './study-questions'
import { ollamaHealth } from './ollama'
import { resolveProvider, testProvider, fetchProviderModels } from './llm'
import { importFromUrl } from './import-url'
import { importMarkdownFolder } from './import-markdown'
import { importBookFromPath } from './book-import'
import {
  findCompanionCaptions,
  findExistingProjectBySource,
  ingestLocalMedia,
  ingestYoutubeMedia,
  listMediaProjects,
  normalizeYoutubeUrl,
  notesNearPlayhead,
  ensureMediaReaderPrompt,
  youtubeEmbedUrl,
} from './media-ingest'
import {
  ensureMediaPersonaPrompts,
  applyMediaPersona,
  createCustomMediaPersona,
  listMediaVoicePacks,
} from './media-personas'
import {
  startBridgeServer,
  stopBridgeServer,
  getBridgeServerStatus,
  getBridgeToken,
  rotateBridgeToken,
} from './bridge-server'
import { encryptLegacySecretFiles } from './secret-files'
import { secretEncryptionAvailable } from './secret-store'
import { checkForUpdate, checkForUpdateOnLaunch, getUpdateSettings, setUpdateSettings } from './update-check'
import { resolveMediaFile, mediaMimeType } from './media-protocol'
import { YOUTUBE_EMBED_FILTER, rewriteYoutubeEmbedHeaders } from './youtube-embed-headers'
import {
  listMcpServers,
  addMcpServer,
  removeMcpServer,
  connectMcpServer,
  disconnectMcpServer,
  cancelMcpAuth,
  listMcpTools,
  callMcpTool,
  ensureNotionServer,
} from './mcp-client'
import {
  buildCitationPackForSession,
  writeCitationPackFolder,
  writeCitationPackZip,
} from './citation-pack'
import {
  getSelection,
  listPresets,
  listProviderConfigs,
  loadProvidersFile,
  removeProvider,
  setProviderEnabled,
  setSelection,
  upsertProvider,
} from './provider-store'
import {
  getPluginContributions,
  installPluginFrom,
  isBundledPluginPath,
  listPluginsResult,
  listRemovedPlugins,
  listBundledPlugins,
  previewPluginFrom,
  pluginsDir,
  reloadPlugins,
  removePlugin,
  restorePlugin,
  setPluginEnabled,
} from './plugin-loader'
import type {
  LlmStatus,
  AskGroundedInput,
  ChatSendInput,
  CitationPackExportInput,
  CreateChatProfileInput,
  CreateItemInput,
  CreatePromptInput,
  CreateSessionInput,
  ItemFilters,
  ListItemsInput,
  SearchQueryInput,
  StudyAttemptInput,
  StudyQuestionsInput,
  TestToNotesAnalyzeInput,
  TestToNotesParseInput,
  ReviewEnqueueInput,
  ReviewListInput,
  ReviewRateInput,
  UpdateChatProfilePatch,
  UpdateItemPatch,
  UpdatePromptPatch,
  MediaIngestLocalInput,
  MediaIngestYoutubeInput,
  MediaNotesNearInput,
  MediaApplyPersonaInput,
  MediaCreatePersonaInput,
  MediaFindExistingInput,
  McpAddServerInput,
  McpCallToolInput,
  MenuAction,
  PersonalityExportInput,
  PersonalityPreviewInput,
  ProviderDraft,
  ProviderSelection,
  UpdateSettings,
} from './types'

// Optional isolated profile (fresh-install demos, tests): LKV_USER_DATA_DIR=/tmp/vault-fresh
if (process.env.LKV_USER_DATA_DIR?.trim()) {
  const dir = process.env.LKV_USER_DATA_DIR.trim()
  fs.mkdirSync(dir, { recursive: true })
  app.setPath('userData', dir)
}

// Single instance (#42): a second launch would open the same database and fight
// over the bridge port. The lock is per userData dir, so an isolated
// LKV_USER_DATA_DIR profile can still run next to the real one.
const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())
}


// Custom protocol for local media playback in <video>/<audio>
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'lkvmedia',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
    },
  },
])

let mainWindow: BrowserWindow | null = null

/**
 * Paths the user explicitly picked via a native open dialog for plugin install.
 * The renderer may only install from these (or from the bundled examples dir),
 * never from an arbitrary path it supplies itself.
 */
const blessedPluginPaths = new Set<string>()

function blessPluginPath(p: string): string {
  const resolved = path.resolve(p)
  blessedPluginPaths.add(resolved)
  return resolved
}

function isAllowedPluginInstallPath(p: string): boolean {
  try {
    const resolved = path.resolve(p)
    return isBundledPluginPath(resolved) || blessedPluginPaths.has(resolved)
  } catch {
    return false
  }
}

/** Keep the YouTube embed loading from the file:// renderer; see youtube-embed-headers.ts. */
function fixYoutubeEmbedHeaders(): void {
  // defaultSession covers the main window (no partition is used anywhere).
  session.defaultSession.webRequest.onBeforeSendHeaders(
    YOUTUBE_EMBED_FILTER,
    rewriteYoutubeEmbedHeaders
  )
}

function dbPath(): string {
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'lkv.sqlite')
}

/** Append a startup failure to <userData>/startup-error.log (best-effort). */
function logStartupError(message: string): void {
  try {
    const dir = app.getPath('userData')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(
      path.join(dir, 'startup-error.log'),
      `[${new Date().toISOString()}] ${message}\n`,
      'utf8'
    )
  } catch {
    /* ignore */
  }
}

/** Move lkv.sqlite (+ WAL/SHM) aside so a fresh vault can be created. */
function backUpDbFiles(): void {
  const dir = app.getPath('userData')
  const ts = Date.now()
  for (const suffix of ['', '-wal', '-shm']) {
    const p = path.join(dir, `lkv.sqlite${suffix}`)
    if (!fs.existsSync(p)) continue
    try {
      fs.renameSync(p, path.join(dir, `lkv.sqlite.backup-${ts}${suffix}`))
    } catch {
      /* leave in place; the next initDb will report it */
    }
  }
}

/**
 * Initialize the database, recovering from failure with a dialog instead of a
 * silent no-window startup. Returns false when the user chooses to quit.
 */
async function initializeDbWithRecovery(): Promise<boolean> {
  const dir = app.getPath('userData')
  for (;;) {
    try {
      initDb(dbPath())
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logStartupError(msg)
      const { response } = await dialog.showMessageBox({
        type: 'error',
        title: 'Vault could not open its database',
        message: 'Vault failed to open the local database.',
        detail:
          `${msg}\n\nYour notes are not lost. "Back up & reset" renames the database file ` +
          `and starts a fresh, empty vault. "Open data folder" shows the files on disk so you ` +
          `can inspect them.`,
        buttons: ['Back up & reset', 'Open data folder', 'Quit'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      })
      if (response === 0) {
        backUpDbFiles()
      } else if (response === 1) {
        void shell.openPath(dir)
      } else {
        return false
      }
    }
  }
}

/** Window/taskbar icon: project build/ in dev; extraResources icon.png when packaged. */
function resolveAppIcon(): string | undefined {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'icon.png')]
    : [
        path.join(__dirname, '..', 'build', 'icon.png'),
        path.join(process.cwd(), 'build', 'icon.png'),
      ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return undefined
}

/** Bring the existing window forward when the app is launched a second time. */
function focusMainWindow(): void {
  if (!mainWindow) {
    if (app.isReady()) createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createWindow(): void {
  const icon = resolveAppIcon()
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Vault',
    backgroundColor: '#0F1419', // M3 dark surface
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // preload only uses contextBridge/ipcRenderer
    },
  })

  // Deny new windows; open http(s) links in the user's browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Block top-frame navigation away from the app's own origin.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedAppUrl(url)) event.preventDefault()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    // mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/** Only the app's own origin (dev server or packaged file://) may navigate the top frame. */
function isTrustedAppUrl(url: string): boolean {
  const dev = process.env.VITE_DEV_SERVER_URL?.trim()
  if (dev && url.startsWith(dev)) return true
  return url.startsWith('file://')
}

/** Forward an application-menu action to the renderer. */
function sendMenuAction(action: MenuAction): void {
  mainWindow?.webContents.send('menu:action', action)
}

/**
 * Application menu with a basic keyboard-shortcut set: ⌘N new note, ⌘F find,
 * ⌘K ask. Standard edit/window roles are kept so clipboard and window shortcuts
 * keep working. Only the custom items forward to the renderer via 'menu:action'.
 */
function buildApplicationMenu(): Menu {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Note',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuAction('new-note'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
        { type: 'separator' as const },
        {
          label: 'Find in Notes',
          accelerator: 'CmdOrCtrl+F',
          click: () => sendMenuAction('find'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Ask',
          accelerator: 'CmdOrCtrl+K',
          click: () => sendMenuAction('ask'),
        },
        { type: 'separator' as const },
        { role: 'reload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    { role: 'windowMenu' as const },
  ]
  return Menu.buildFromTemplate(template)
}

/** Abort controller for the in-flight media ingest, if any (#128). */
let currentIngestController: AbortController | null = null

function registerIpc(): void {
  ipcMain.handle('items:list', (_e, input?: ListItemsInput) => {
    return listItems(input?.filters)
  })

  ipcMain.handle('items:create', (_e, input: CreateItemInput) => {
    return createItem(input)
  })

  ipcMain.handle('items:get', (_e, id: string) => {
    return getItem(id)
  })

  ipcMain.handle('items:update', (_e, id: string, patch: UpdateItemPatch) => {
    return updateItem(id, patch)
  })

  ipcMain.handle('items:delete', (_e, id: string) => {
    return deleteItem(id)
  })
  ipcMain.handle('items:trash', (_e, id: string) => trashItem(id))
  ipcMain.handle('items:restore', (_e, id: string) => restoreItem(id))
  ipcMain.handle('items:listTrashed', () => listTrashedItems())
  ipcMain.handle('items:emptyTrash', () => emptyTrash())
  ipcMain.handle('items:listSamples', () => listSampleNotes())
  ipcMain.handle('items:removeSamples', () => removeSampleNotes())
  ipcMain.handle('items:count', () => countItems())

  ipcMain.handle('search:query', (_e, input: SearchQueryInput) => {
    return searchQuery(input)
  })

  ipcMain.handle('ask:grounded', (_e, input: AskGroundedInput) => {
    return askGrounded(input)
  })

  // Test to notes (#166): grounded corrective notes for wrong practice answers.
  ipcMain.handle('testToNotes:analyze', (_e, input: TestToNotesAnalyzeInput) =>
    analyzeTestResults(input?.items ?? [], { filters: input?.filters, limit: input?.limit })
  )
  ipcMain.handle('testToNotes:parse', (_e, input: TestToNotesParseInput) =>
    parseTestResultsWithAi(input)
  )

  // Spaced review (#216) over study cards (#259 card model).
  ipcMain.handle('review:listDue', (_e, input?: ReviewListInput) =>
    listDueReviews(input?.before, input?.limit, input?.project)
  )
  ipcMain.handle('review:count', (_e, input?: ReviewListInput) =>
    countDueReviews(input?.before, input?.project)
  )
  ipcMain.handle('review:rate', (_e, input: ReviewRateInput) =>
    // The exam date comes from the card's project (#261), not from the caller.
    rateReview(String(input.cardId ?? input.itemId ?? ''), input.grade)
  )
  ipcMain.handle('review:enqueue', (_e, input: ReviewEnqueueInput) => enqueueReview(input.itemId))
  ipcMain.handle('review:remove', (_e, itemId: string) => removeReview(itemId))
  // Study home (#262): bulk "Study this project" and the project's numbers.
  ipcMain.handle('review:enqueueProject', (_e, project: string) => enrollProject(String(project ?? '')))
  ipcMain.handle('review:stats', (_e, project?: string) => getStudyStats(project ?? undefined))

  // Study mode (#215): recall-before-reveal attempts + calibration.
  ipcMain.handle('study:record', (_e, input: StudyAttemptInput) => recordStudyAttempt(input))
  ipcMain.handle('study:listRecent', (_e, limit?: number) => listRecentAttempts(limit))
  ipcMain.handle('study:calibration', () => studyCalibration())
  ipcMain.handle('study:questions', (_e, input: StudyQuestionsInput) => generateStudyQuestions(input))

  ipcMain.handle('ollama:health', () => {
    return ollamaHealth()
  })

  // LLM provider registry (keys never cross IPC — renderer only sees hasKey)
  ipcMain.handle('llm:status', async () => {
    const resolved = await resolveProvider()
    const keyStorage: LlmStatus['keyStorage'] = secretEncryptionAvailable() ? 'encrypted' : 'plaintext'
    return { ...resolved.status, keyStorage }
  })
  ipcMain.handle('providers:list', () => ({
    providers: listProviderConfigs(),
    selected: getSelection(),
    presets: listPresets(),
  }))
  ipcMain.handle('providers:setSelected', (_e, sel: ProviderSelection) => setSelection(sel))
  ipcMain.handle('providers:setEnabled', (_e, id: string, enabled: boolean) => {
    setProviderEnabled(id, !!enabled)
    return listProviderConfigs()
  })
  ipcMain.handle('providers:save', (_e, draft: ProviderDraft) => upsertProvider(draft))
  ipcMain.handle('providers:remove', (_e, id: string) => removeProvider(id))
  ipcMain.handle('providers:test', (_e, draft: ProviderDraft) => testProvider(draft))
  ipcMain.handle('providers:fetchModels', (_e, draft: ProviderDraft) => fetchProviderModels(draft))

  // Declarative plugins
  ipcMain.handle('plugins:list', () => listPluginsResult())
  ipcMain.handle('plugins:reload', () => {
    reloadPlugins()
    return listPluginsResult()
  })
  ipcMain.handle('plugins:setEnabled', (_e, id: string, enabled: boolean) => setPluginEnabled(id, !!enabled))
  ipcMain.handle('plugins:remove', (_e, id: string) => removePlugin(id))
  ipcMain.handle('plugins:contributions', () => getPluginContributions())
  ipcMain.handle('plugins:openFolder', async () => {
    const dir = pluginsDir()
    fs.mkdirSync(dir, { recursive: true })
    const err = await shell.openPath(dir)
    return { path: dir, error: err || undefined }
  })
  ipcMain.handle('plugins:install', async (_e, kind?: 'folder' | 'zip') => {
    const opts: OpenDialogOptions =
      kind === 'zip'
        ? {
            title: 'Install plugin (.zip)',
            properties: ['openFile'],
            filters: [{ name: 'Plugin zip', extensions: ['zip'] }],
          }
        : { title: 'Install plugin (folder with plugin.json)', properties: ['openDirectory'] }
    const r = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }
    return installPluginFrom(blessPluginPath(r.filePaths[0]))
  })

  // Add-on preview (no install yet), bundled examples, and recoverable removed add-ons.
  ipcMain.handle('plugins:preview', async (_e, kind?: 'folder' | 'zip') => {
    const opts: OpenDialogOptions =
      kind === 'zip'
        ? { title: 'Choose an add-on (.zip)', properties: ['openFile'], filters: [{ name: 'Add-on zip', extensions: ['zip'] }] }
        : kind === 'folder'
          ? { title: 'Choose an add-on folder', properties: ['openDirectory'] }
          : {
              title: 'Choose an add-on (folder or .zip)',
              properties: ['openFile', 'openDirectory'],
              filters: [{ name: 'Add-on zip', extensions: ['zip'] }],
            }
    const r = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return { canceled: true }
    return previewPluginFrom(blessPluginPath(r.filePaths[0]))
  })
  ipcMain.handle('plugins:installFromPath', (_e, srcPath: string) => {
    // The renderer must not install from an arbitrary path: only bundled
    // examples (listBundled) or a path the user just picked via the dialog.
    if (!srcPath || !isAllowedPluginInstallPath(srcPath)) {
      throw new Error('Plugin install path not authorized — pick it from the file dialog')
    }
    return installPluginFrom(srcPath)
  })
  ipcMain.handle('plugins:listRemoved', () => listRemovedPlugins())
  ipcMain.handle('plugins:restore', (_e, key: string) => restorePlugin(key))
  ipcMain.handle('plugins:listBundled', () => listBundledPlugins())

  ipcMain.handle('app:openExternal', async (_e, url: string) => {
    try {
      const u = new URL(url)
      if (u.protocol !== 'https:') return false
      await shell.openExternal(u.toString())
      return true
    } catch {
      return false
    }
  })

  // Chat
  ipcMain.handle('chat:listSessions', () => listSessions())
  ipcMain.handle('chat:createSession', (_e, input?: CreateSessionInput) => createSession(input))
  ipcMain.handle('chat:getSession', (_e, id: string) => getSession(id))
  ipcMain.handle('chat:deleteSession', (_e, id: string) => deleteSession(id))
  ipcMain.handle('chat:updateSessionTitle', (_e, id: string, title: string) =>
    updateSessionTitle(id, title)
  )
  ipcMain.handle('chat:listMessages', (_e, sessionId: string) => listMessages(sessionId))
  ipcMain.handle('chat:send', (_e, input: ChatSendInput) => sendChatTurn(input))

  // Import from URL
  ipcMain.handle('import:fromUrl', (_e, url: string) => {
    return importFromUrl(url)
  })

  // Import Markdown / Obsidian notes from a folder (main picks the folder)
  ipcMain.handle('import:markdown', async () => {
    const opts: OpenDialogOptions = {
      title: 'Import Markdown / Obsidian notes',
      properties: ['openDirectory'],
    }
    const r = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) {
      return { canceled: true, imported: 0, skipped: 0, itemIds: [], errors: [] }
    }
    return importMarkdownFolder(r.filePaths[0])
  })

  // Import a local EPUB / text-layer PDF as book notes (main picks the file)
  ipcMain.handle('import:book', async () => {
    const opts: OpenDialogOptions = {
      title: 'Import book / PDF',
      properties: ['openFile'],
      filters: [
        { name: 'Books', extensions: ['epub', 'pdf'] },
        { name: 'All files', extensions: ['*'] },
      ],
    }
    const r = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) {
      return { canceled: true, imported: 0, skipped: 0, itemIds: [], errors: [] }
    }
    return importBookFromPath(r.filePaths[0])
  })

  // Prompts
  ipcMain.handle('prompts:list', () => listPrompts())
  ipcMain.handle('prompts:get', (_e, id: string) => getPrompt(id))
  ipcMain.handle('prompts:create', (_e, input: CreatePromptInput) => createPrompt(input))
  ipcMain.handle('prompts:update', (_e, id: string, patch: UpdatePromptPatch) =>
    updatePrompt(id, patch)
  )
  ipcMain.handle('prompts:delete', (_e, id: string) => deletePrompt(id))

  // Export / import a personality as a portable JSON pack (#164).
  ipcMain.handle('prompts:export', async (_e, input: PersonalityExportInput) => {
    const prompt = input?.id ? getPrompt(input.id) : null
    if (!prompt) return { error: 'That personality no longer exists.' }
    const target = input.target === 'clipboard' ? 'clipboard' : 'file'
    const json = serializePersonalityPack(prompt)
    if (target === 'clipboard') {
      clipboard.writeText(json)
      return { target, name: prompt.name }
    }
    // The output location is chosen by the main process (native save dialog),
    // never a renderer-supplied path.
    const downloads = app.getPath('downloads')
    const saveOpts = {
      title: 'Export personality',
      defaultPath: path.join(downloads, personalityFileName(prompt.name)),
      filters: [
        { name: 'Personality JSON', extensions: ['json'] },
        { name: 'All files', extensions: ['*'] },
      ],
    }
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, saveOpts)
      : await dialog.showSaveDialog(saveOpts)
    if (result.canceled || !result.filePath) return { canceled: true, target }
    let filePath = result.filePath
    if (!filePath.toLowerCase().endsWith('.json')) filePath = `${filePath}.json`
    fs.writeFileSync(filePath, json, 'utf8')
    return { target, path: filePath, name: prompt.name }
  })

  ipcMain.handle('prompts:import', async () => {
    const opts: OpenDialogOptions = {
      title: 'Import personality',
      properties: ['openFile'],
      filters: [
        { name: 'Personality JSON', extensions: ['json'] },
        { name: 'All files', extensions: ['*'] },
      ],
    }
    const picked = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts)
    if (picked.canceled || !picked.filePaths[0]) return { canceled: true }
    let text: string
    try {
      text = fs.readFileSync(picked.filePaths[0], 'utf8')
    } catch {
      return { error: 'Could not read that file.' }
    }
    const parsed = parsePersonalityPack(text)
    if (!parsed.ok) return { error: parsed.error }
    // Import never overwrites: a clashing name gets a " (2)" suffix.
    const prompt = createPrompt({
      name: uniquePromptName(parsed.pack.name),
      body: parsed.pack.body,
      description: parsed.pack.description,
    })
    return { prompt }
  })

  // Preview a draft personality against the user's own notes (#164).
  ipcMain.handle('prompts:preview', async (_e, input: PersonalityPreviewInput) => {
    const question = (input?.question ?? '').trim()
    if (!question) return { answer: '', citations: [], error: 'Enter a question to test.' }
    const body = (input?.body ?? '').trim()
    const primary = await askGrounded({
      question,
      filters: input?.filters,
      systemExtra: body || undefined,
    })
    const base = {
      answer: primary.answer,
      citations: primary.citations,
      offline: primary.offline,
      error: primary.error,
    }
    if (!input?.compare) return base
    const plain = await askGrounded({ question, filters: input?.filters })
    return {
      ...base,
      defaultAnswer: plain.answer,
      defaultCitations: plain.citations,
      defaultOffline: plain.offline,
    }
  })

  // Chat profiles (user-saved Personality + Project)
  ipcMain.handle('profiles:list', () => listChatProfiles())
  ipcMain.handle('profiles:get', (_e, id: string) => getChatProfile(id))
  ipcMain.handle('profiles:create', (_e, input: CreateChatProfileInput) =>
    createChatProfile(input)
  )
  ipcMain.handle('profiles:update', (_e, id: string, patch: UpdateChatProfilePatch) =>
    updateChatProfile(id, patch)
  )
  ipcMain.handle('profiles:delete', (_e, id: string) => deleteChatProfile(id))

  // Projects (first-class: list / rename / merge / delete)
  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:rename', (_e, from: string, to: string) => renameProject(from, to))
  ipcMain.handle('projects:merge', (_e, from: string, into: string) => mergeProject(from, into))
  ipcMain.handle('projects:delete', (_e, name: string) => deleteProject(name))
  // Per-project settings (#261): the exam date drives exam-aware spacing.
  ipcMain.handle('projects:getSettings', (_e, name: string) => getProjectSettings(String(name ?? '')))
  ipcMain.handle('projects:setExamDate', (_e, name: string, examDate: string | null) =>
    setProjectExamDate(String(name ?? ''), examDate ?? null)
  )

  // Citation pack export (Ask session → portable evidence bundle)
  ipcMain.handle('citationPack:export', async (_e, input: CitationPackExportInput) => {
    const sessionId = input?.sessionId
    if (!sessionId) throw new Error('sessionId is required')

    const pack = buildCitationPackForSession(sessionId, {
      profileHint: input.profileHint,
    })

    // The output location is always chosen by the main process (native save
    // dialog, defaulting to Downloads) — never a renderer-supplied path.
    const downloads = app.getPath('downloads')
    const defaultName = `${pack.folderName}.zip`
    const saveOpts = {
      title: 'Export citation pack',
      defaultPath: path.join(downloads, defaultName),
      filters: [
        { name: 'Zip archive', extensions: ['zip'] },
        { name: 'All files', extensions: ['*'] },
      ],
    }
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, saveOpts)
      : await dialog.showSaveDialog(saveOpts)
    if (result.canceled || !result.filePath) {
      return { canceled: true }
    }

    let zipPath = result.filePath
    if (!zipPath.toLowerCase().endsWith('.zip')) zipPath = `${zipPath}.zip`
    writeCitationPackZip(zipPath, pack)

    // Also write unpacked folder next to the zip for easy browsing / paste
    const folderPath = zipPath.replace(/\.zip$/i, '')
    writeCitationPackFolder(folderPath, pack)

    return {
      path: zipPath,
      zipPath,
      folderPath,
      noteCount: pack.manifest.noteIds.length,
      missingCount: pack.manifest.missingIds.length,
    }
  })

  // Media chat ingest
  ipcMain.handle('media:pickLocal', async () => {
    const mediaOpts: OpenDialogOptions = {
      title: 'Choose video or audio',
      properties: ['openFile'],
      filters: [
        { name: 'Media', extensions: ['mp4', 'webm', 'mkv', 'mov', 'mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'] },
        { name: 'All files', extensions: ['*'] },
      ],
    }
    const mediaResult = mainWindow
      ? await dialog.showOpenDialog(mainWindow, mediaOpts)
      : await dialog.showOpenDialog(mediaOpts)
    if (mediaResult.canceled || !mediaResult.filePaths[0]) {
      return { canceled: true }
    }
    const mediaPath = mediaResult.filePaths[0]
    let captionsPath = findCompanionCaptions(mediaPath)
    let companionCaptionsFound = !!captionsPath
    if (!captionsPath) {
      const capOpts: OpenDialogOptions = {
        title: 'Choose captions (.srt or .vtt)',
        properties: ['openFile'],
        filters: [
          { name: 'Captions', extensions: ['srt', 'vtt'] },
          { name: 'All files', extensions: ['*'] },
        ],
      }
      const capResult = mainWindow
        ? await dialog.showOpenDialog(mainWindow, capOpts)
        : await dialog.showOpenDialog(capOpts)
      if (capResult.canceled || !capResult.filePaths[0]) {
        return { canceled: true, mediaPath }
      }
      captionsPath = capResult.filePaths[0]
    }
    return {
      canceled: false,
      mediaPath,
      captionsPath,
      companionCaptionsFound,
    }
  })

  ipcMain.handle('media:ingestLocal', async (_e, input: MediaIngestLocalInput) => {
    const controller = new AbortController()
    currentIngestController = controller
    try {
      return await ingestLocalMedia(input, {
        onProgress: (stage, noteCount) => {
          _e.sender.send('media:ingestProgress', { stage, noteCount })
        },
        signal: controller.signal,
      })
    } finally {
      if (currentIngestController === controller) currentIngestController = null
    }
  })

  ipcMain.handle('media:ingestYoutube', async (_e, input: MediaIngestYoutubeInput) => {
    const controller = new AbortController()
    currentIngestController = controller
    try {
      return await ingestYoutubeMedia(input, {
        onProgress: (stage, noteCount) => {
          _e.sender.send('media:ingestProgress', { stage, noteCount })
        },
        signal: controller.signal,
      })
    } finally {
      if (currentIngestController === controller) currentIngestController = null
    }
  })

  ipcMain.handle('media:cancelIngest', () => {
    currentIngestController?.abort()
    return true
  })

  ipcMain.handle('media:listProjects', () => listMediaProjects())

  ipcMain.handle('media:findExistingProject', (_e, input?: MediaFindExistingInput) => {
    if (input?.mediaPath) {
      return findExistingProjectBySource({ sourcePath: path.resolve(input.mediaPath) })
    }
    if (input?.url) {
      const url = normalizeYoutubeUrl(input.url)
      if (!url) return null
      return findExistingProjectBySource({ sourceUrl: url })
    }
    return null
  })

  ipcMain.handle('media:notesNear', (_e, input: MediaNotesNearInput) => {
    return notesNearPlayhead(input.project, input.centerSec, input.windowSec ?? 45)
  })

  ipcMain.handle('media:youtubeEmbedUrl', (_e, url: string) => youtubeEmbedUrl(url))

  ipcMain.handle('media:ensurePersonas', () => {
    const r = ensureMediaPersonaPrompts()
    return {
      promptIds: r.prompts.map((p) => p.id),
      names: r.prompts.map((p) => p.name),
      created: r.created,
      updated: r.updated,
    }
  })

  ipcMain.handle('media:applyPersona', (_e, input: MediaApplyPersonaInput) => {
    const r = applyMediaPersona(input)
    return {
      promptId: r.prompt.id,
      profileId: r.profile.id,
      personaName: r.persona.name,
      profileName: r.profile.name,
    }
  })

  ipcMain.handle('media:createPersona', (_e, input: MediaCreatePersonaInput) => {
    return createCustomMediaPersona(input)
  })

  ipcMain.handle('media:listVoicePacks', () => listMediaVoicePacks())

  // Update notice (#42): a version check against GitHub Releases; never downloads or installs.
  const updateEnv = () => ({
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    isSnap: !!process.env.SNAP,
    fetchImpl: net.fetch as typeof fetch,
  })
  ipcMain.handle('updates:checkOnLaunch', () => checkForUpdateOnLaunch(updateEnv()))
  ipcMain.handle('updates:check', () => {
    const { currentVersion, fetchImpl } = updateEnv()
    return checkForUpdate({ currentVersion, fetchImpl })
  })
  ipcMain.handle('updates:getSettings', () => getUpdateSettings())
  ipcMain.handle('updates:setSettings', (_e, patch: Partial<UpdateSettings>) =>
    setUpdateSettings({ checkOnLaunch: patch?.checkOnLaunch !== false })
  )

  ipcMain.handle('bridge:status', () => getBridgeServerStatus())
  ipcMain.handle('bridge:getToken', () => getBridgeToken())
  ipcMain.handle('bridge:rotateToken', () => rotateBridgeToken())

  // MCP connections (Notion MCP + arbitrary Streamable HTTP servers)
  ipcMain.handle('mcp:listServers', () => listMcpServers())
  ipcMain.handle('mcp:addServer', (_e, input: McpAddServerInput) => addMcpServer(input))
  ipcMain.handle('mcp:ensureNotion', () => ensureNotionServer())
  ipcMain.handle('mcp:removeServer', (_e, id: string) => removeMcpServer(id))
  ipcMain.handle('mcp:connect', (_e, id: string) => connectMcpServer(id))
  ipcMain.handle('mcp:disconnect', (_e, id: string) => disconnectMcpServer(id))
  ipcMain.handle('mcp:cancelAuth', (_e, id: string) => cancelMcpAuth(id))
  ipcMain.handle('mcp:listTools', (_e, id: string) => listMcpTools(id))
  ipcMain.handle('mcp:callTool', (_e, input: McpCallToolInput) =>
    callMcpTool(input.id, input.name, input.args)
  )

}

app.whenReady().then(async () => {
  // The second instance is already quitting; don't open the DB or the bridge.
  if (!hasInstanceLock) return
  fixYoutubeEmbedHeaders()
  protocol.handle('lkvmedia', async (request) => {
    try {
      const u = new URL(request.url)
      // lkvmedia://media/<opaque-id> — the id is looked up in the registry,
      // never a filesystem path.
      const id = u.pathname.replace(/^\/+/, '').split('/')[0]
      if (!id) {
        return new Response('missing media id', { status: 400 })
      }
      const filePath = resolveMediaFile(id)
      if (!filePath) {
        return new Response('unknown media id', { status: 404 })
      }
      const headers: Record<string, string> = {}
      const range = request.headers.get('range')
      if (range) headers.Range = range
      const res = await net.fetch(pathToFileURL(filePath).href, { headers })
      const outHeaders: Record<string, string> = {
        'Content-Type': mediaMimeType(filePath),
        'Accept-Ranges': 'bytes',
      }
      if (res.status === 206 && res.headers.get('content-range')) {
        outHeaders['Content-Range'] = res.headers.get('content-range')!
      }
      return new Response(res.body, { status: res.status, headers: outHeaders })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return new Response(msg, { status: 500 })
    }
  })

  if (!(await initializeDbWithRecovery())) {
    app.quit()
    return
  }
  try {
    ensureMediaReaderPrompt()
  } catch {
    /* seed best-effort */
  }
  try {
    ensureMediaPersonaPrompts()
  } catch {
    /* seed best-effort */
  }
  try {
    reloadPlugins()
  } catch (err) {
    console.error('[Vault plugins] load failed:', err)
  }
  try {
    // Before the bridge or any provider reads them: encrypt secrets still stored as plaintext (#237).
    encryptLegacySecretFiles()
  } catch (err) {
    console.error('[Vault secrets] encryption check failed:', err instanceof Error ? err.message : String(err))
  }
  try {
    loadProvidersFile() // creates lkv-providers.json (migrating lkv-llm.json) on first run
  } catch (err) {
    console.error('[Vault providers] load failed:', err)
  }
  registerIpc()
  Menu.setApplicationMenu(buildApplicationMenu())
  createWindow()
  try {
    startBridgeServer()
  } catch (err) {
    console.error('[Vault Bridge] failed to start:', err)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeDb()
    app.quit()
  }
})

app.on('before-quit', () => {
  stopBridgeServer()
  closeDb()
})

// Silence unused import warning for filters type in some tooling
export type { ItemFilters }
