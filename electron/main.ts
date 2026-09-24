/**
 * Electron main process — app lifecycle + IPC handlers.
 */
import { app, BrowserWindow, dialog, ipcMain, net, protocol, type OpenDialogOptions } from 'electron'
import path from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'
import {
  closeDb,
  createChatProfile,
  createItem,
  createPrompt,
  createSession,
  deleteChatProfile,
  deleteItem,
  deletePrompt,
  deleteSession,
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
  updateChatProfile,
  updateItem,
  updatePrompt,
  updateSessionTitle,
} from './db'
import { searchQuery } from './search'
import { askGrounded } from './generate'
import { sendChatTurn } from './chat'
import { ollamaHealth } from './ollama'
import { resolveProvider } from './llm'
import { importFromUrl } from './import-url'
import {
  findCompanionCaptions,
  ingestLocalMedia,
  ingestYoutubeMedia,
  listMediaProjects,
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
import { startBridgeServer, stopBridgeServer, getBridgeServerStatus } from './bridge-server'
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
  writeCitationPack,
  writeCitationPackFolder,
  writeCitationPackZip,
} from './citation-pack'
import {
  getLlmSettingsPublic,
  setLlmSettings,
  setXaiApiKey,
  hasXaiApiKey,
  setGroqApiKey,
  hasGroqApiKey,
  type LlmSettings,
} from './llm-settings'
import type {
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
  UpdateChatProfilePatch,
  UpdateItemPatch,
  UpdatePromptPatch,
  MediaIngestLocalInput,
  MediaIngestYoutubeInput,
  MediaNotesNearInput,
  MediaApplyPersonaInput,
  MediaCreatePersonaInput,
  McpAddServerInput,
  McpCallToolInput,
} from './types'


// Custom protocol for local media playback in <video>/<audio>
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'lkvmedia',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
])

let mainWindow: BrowserWindow | null = null

function dbPath(): string {
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'lkv.sqlite')
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
      sandbox: false, // better-sqlite3 is main-only; preload stays thin
    },
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

  ipcMain.handle('search:query', (_e, input: SearchQueryInput) => {
    return searchQuery(input)
  })

  ipcMain.handle('ask:grounded', (_e, input: AskGroundedInput) => {
    return askGrounded(input)
  })

  ipcMain.handle('ollama:health', () => {
    return ollamaHealth()
  })

  // LLM provider settings / status (never return full API key)
  ipcMain.handle('llm:status', async () => {
    const resolved = await resolveProvider()
    return resolved.status
  })
  ipcMain.handle('llm:getSettings', () => getLlmSettingsPublic())
  ipcMain.handle('llm:setSettings', (_e, partial: Partial<LlmSettings>) => {
    setLlmSettings(partial ?? {})
    return getLlmSettingsPublic()
  })
  ipcMain.handle('llm:setApiKey', (_e, key: string | null) => {
    setXaiApiKey(key)
    return { hasKey: hasXaiApiKey() }
  })
  ipcMain.handle('llm:hasKey', () => hasXaiApiKey())
  ipcMain.handle('llm:setGroqApiKey', (_e, key: string | null) => {
    setGroqApiKey(key)
    return { hasGroqKey: hasGroqApiKey() }
  })
  ipcMain.handle('llm:hasGroqKey', () => hasGroqApiKey())

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

  // Prompts
  ipcMain.handle('prompts:list', () => listPrompts())
  ipcMain.handle('prompts:get', (_e, id: string) => getPrompt(id))
  ipcMain.handle('prompts:create', (_e, input: CreatePromptInput) => createPrompt(input))
  ipcMain.handle('prompts:update', (_e, id: string, patch: UpdatePromptPatch) =>
    updatePrompt(id, patch)
  )
  ipcMain.handle('prompts:delete', (_e, id: string) => deletePrompt(id))

  // Chat profiles (user-saved Personality + Notes from)
  ipcMain.handle('profiles:list', () => listChatProfiles())
  ipcMain.handle('profiles:get', (_e, id: string) => getChatProfile(id))
  ipcMain.handle('profiles:create', (_e, input: CreateChatProfileInput) =>
    createChatProfile(input)
  )
  ipcMain.handle('profiles:update', (_e, id: string, patch: UpdateChatProfilePatch) =>
    updateChatProfile(id, patch)
  )
  ipcMain.handle('profiles:delete', (_e, id: string) => deleteChatProfile(id))

  // Citation pack export (Ask session → portable evidence bundle)
  ipcMain.handle('citationPack:export', async (_e, input: CitationPackExportInput) => {
    const sessionId = input?.sessionId
    if (!sessionId) throw new Error('sessionId is required')

    const pack = buildCitationPackForSession(sessionId, {
      profileHint: input.profileHint,
    })

    // Headless / smoke: write folder + zip under outputDir
    if (input.outputDir) {
      fs.mkdirSync(input.outputDir, { recursive: true })
      const { folderPath, zipPath } = writeCitationPack(input.outputDir, pack)
      return {
        path: zipPath,
        zipPath,
        folderPath,
        noteCount: pack.manifest.noteIds.length,
        missingCount: pack.manifest.missingIds.length,
      }
    }

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

  ipcMain.handle('media:ingestLocal', (_e, input: MediaIngestLocalInput) => {
    return ingestLocalMedia(input)
  })

  ipcMain.handle('media:ingestYoutube', (_e, input: MediaIngestYoutubeInput) => {
    return ingestYoutubeMedia(input)
  })

  ipcMain.handle('media:listProjects', () => listMediaProjects())

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

  ipcMain.handle('bridge:status', () => getBridgeServerStatus())

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

app.whenReady().then(() => {
  protocol.handle('lkvmedia', (request) => {
    try {
      const u = new URL(request.url)
      const filePath = u.searchParams.get('path')
      if (!filePath) {
        return new Response('missing path', { status: 400 })
      }
      return net.fetch(pathToFileURL(filePath).href)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return new Response(msg, { status: 500 })
    }
  })

  initDb(dbPath())
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
  registerIpc()
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
