/**
 * Offline smoke tests for Electron main process (IPC handlers) and preload surface.
 * Stubs Electron modules via Module._load so no native Electron is needed.
 * Runs under Electron-as-Node.
 *
 *   npm run test:ipc-preload
 */

// --- Module._load hook to mock Electron MUST BE FIRST ---
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module') as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown
}
const origLoad = Module._load

// Mutable state for mocks
const ipcHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
const appListeners: Record<string, (() => void)[]> = {}
let userDataDir = ''

// We need fs, os, path for the mocks
const fs = require('fs')
const os = require('os')
const path = require('path')

userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-ipc-'))

const mockApp = {
  whenReady: async () => {},
  getPath: (name: string) => {
    if (name === 'userData') return userDataDir
    if (name === 'downloads') return fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-downloads-'))
    if (name === 'home') return os.homedir()
    return fs.mkdtempSync(path.join(os.tmpdir(), `lkv-${name}-`))
  },
  setPath: (_name: string, p: string) => { userDataDir = p },
  isPackaged: false,
  quit: () => {},
  on: (event: string, listener: () => void) => {
    ;(appListeners[event] ||= []).push(listener)
  },
  onBeforeQuit: (listener: () => void) => {
    ;(appListeners['before-quit'] ||= []).push(listener)
  },
}

function MockBrowserWindow(opts?: Record<string, unknown>) {
  const instance = {
    webContents: {
      setWindowOpenHandler: (h: (d: { url: string }) => { action: 'deny' }) => {},
      on: (event: string, listener: (e: unknown, url: string) => void) => {},
      loadURL: (url: string) => {},
      loadFile: (file: string) => {},
      openDevTools: (opts?: unknown) => {},
    },
    on: (event: string, listener: () => void) => {},
    loadURL: (url: string) => {},
    loadFile: (file: string) => {},
    openDevTools: (opts?: unknown) => {},
  }
  return instance
}
MockBrowserWindow.getAllWindows = () => []
const mockBrowserWindow = MockBrowserWindow

const mockDialog = {
  showMessageBox: async (opts: unknown) => ({ response: 0 }),
  showOpenDialog: async (opts: unknown) => ({ canceled: true, filePaths: [] }),
  showSaveDialog: async (opts: unknown) => ({ canceled: true, filePath: undefined }),
}

const ipcRendererMock = {
  invoke: async (channel: string, ...args: unknown[]) => {
    const handler = ipcHandlers.get(channel)
    if (!handler) return { error: `No handler for ${channel}` }
    return handler({} as Electron.IpcMainInvokeEvent, ...args)
  },
}

const exposedApi: Record<string, unknown> = {}
const mockContextBridge = {
  exposeInMainWorld: (name: string, api: unknown) => {
    if (name === 'lkv') {
      Object.assign(exposedApi, api as Record<string, unknown>)
    }
  },
}

const mockSession = {
  defaultSession: {
    webRequest: {
      onBeforeSendHeaders: (
        filter: unknown,
        listener: (details: unknown, callback: (response: unknown) => void) => void
      ) => {
        try {
          listener(
            {
              url: 'https://www.youtube-nocookie.com/embed/test',
              referrer: 'file:///app/index.html',
              requestHeaders: {},
            },
            () => {}
          )
        } catch {
          /* ignore */
        }
      },
    },
  },
}

const mockProtocol = {
  registerSchemesAsPrivileged: (schemes: unknown[]) => {},
  handle: (scheme: string, handler: (request: unknown) => Promise<unknown>) => {
    if (scheme === 'lkvmedia') {
      handler({ url: 'lkvmedia://media/test-id', headers: { get: () => null } }).catch(() => {})
    }
  },
}

const mockNet = {
  fetch: async (url: string) => ({
    status: 200,
    headers: { get: () => null },
    body: new ReadableStream(),
  }),
}

const mockShell = {
  openExternal: async (url: string) => {},
  openPath: async (p: string) => '',
}

const mockMenu = {
  buildFromTemplate: (template: unknown[]) => ({ template }),
  setApplicationMenu: () => {},
}

// Install mock BEFORE any require() calls
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return {
      app: mockApp,
      BrowserWindow: mockBrowserWindow,
      dialog: mockDialog,
      ipcMain: {
        handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
          ipcHandlers.set(channel, handler)
        },
        removeHandler: (channel: string) => {
          ipcHandlers.delete(channel)
        },
      },
      ipcRenderer: ipcRendererMock,
      contextBridge: mockContextBridge,
      session: mockSession,
      protocol: mockProtocol,
      net: mockNet,
      shell: mockShell,
      Menu: mockMenu,
    }
  }
  return origLoad.call(this, request, parent, isMain)
}

// --- NOW require electron modules (they will get mocked electron) ---
const { initDb, closeDb } = require('../electron/db')
require('../electron/main')
require('../electron/preload')

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${msg}`)
  } else {
    failed++
    console.error(`  ✗ ${msg}`)
  }
}

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — IPC + Preload smoke ===\n')

  // 1) Initialize DB
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-ipc-db-')), 'test.sqlite')
  initDb(dbFile)
  mockApp.setPath('userData', path.dirname(dbFile))

  // 2) Wait for app.whenReady().then(...) to run (registers IPC)
  await new Promise(r => setTimeout(r, 200))

  // 3) Test key IPC handlers are registered
  console.log('IPC handlers (main.ts)')
  const handlers = ipcHandlers

  const expectedHandlers = [
    // items
    'items:list', 'items:create', 'items:get', 'items:update', 'items:delete',
    // search
    'search:query',
    // ask
    'ask:grounded',
    // ollama
    'ollama:health',
    // llm
    'llm:status',
    // providers
    'providers:list', 'providers:setSelected', 'providers:setEnabled',
    'providers:save', 'providers:remove', 'providers:test', 'providers:fetchModels',
    // plugins
    'plugins:list', 'plugins:reload', 'plugins:setEnabled', 'plugins:remove',
    'plugins:contributions', 'plugins:openFolder', 'plugins:install',
    // app
    'app:openExternal',
    // chat
    'chat:listSessions', 'chat:createSession', 'chat:getSession', 'chat:deleteSession',
    'chat:updateSessionTitle', 'chat:listMessages', 'chat:send',
    // import
    'import:fromUrl',
    // prompts
    'prompts:list', 'prompts:get', 'prompts:create', 'prompts:update', 'prompts:delete',
    // profiles
    'profiles:list', 'profiles:get', 'profiles:create', 'profiles:update', 'profiles:delete',
    // citationPack
    'citationPack:export',
    // media
    'media:pickLocal', 'media:ingestLocal', 'media:ingestYoutube', 'media:listProjects',
    'media:notesNear', 'media:youtubeEmbedUrl', 'media:ensurePersonas',
    'media:applyPersona', 'media:createPersona', 'media:listVoicePacks',
    // bridge
    'bridge:status', 'bridge:getToken', 'bridge:rotateToken',
    // mcp
    'mcp:listServers', 'mcp:addServer', 'mcp:ensureNotion', 'mcp:removeServer',
    'mcp:connect', 'mcp:disconnect', 'mcp:cancelAuth', 'mcp:listTools', 'mcp:callTool',
  ]

  for (const h of expectedHandlers) {
    assert(handlers.has(h), `${h} registered`)
  }

  // 4) Test some actual handler invocations (via ipcRenderer mock)
  console.log('\nIPC handler invocations')
  const result = await ipcRendererMock.invoke('items:list') as unknown[]
  assert(Array.isArray(result), 'items:list returns array')

  const created = await ipcRendererMock.invoke('items:create', { title: 'Test', body: 'Body', kind: 'note', project: '' }) as { id: string }
  assert(created && typeof created.id === 'string', 'items:create returns item with id')

  const searchResult = await ipcRendererMock.invoke('search:query', { text: 'test', limit: 5 }) as { hits: unknown[] }
  assert(searchResult && Array.isArray(searchResult.hits), 'search:query returns hits array')

  const ollamaHealth = await ipcRendererMock.invoke('ollama:health') as object
  assert(ollamaHealth && typeof ollamaHealth === 'object', 'ollama:health returns object')

  const providersList = await ipcRendererMock.invoke('providers:list') as { providers: unknown[] }
  assert(providersList && Array.isArray(providersList.providers), 'providers:list returns providers array')

  const pluginsList = await ipcRendererMock.invoke('plugins:list') as { plugins: unknown[] }
  assert(pluginsList && Array.isArray(pluginsList.plugins), 'plugins:list returns plugins array')

  const sessions = await ipcRendererMock.invoke('chat:listSessions') as unknown[]
  assert(Array.isArray(sessions), 'chat:listSessions returns array')

  const prompts = await ipcRendererMock.invoke('prompts:list') as unknown[]
  assert(Array.isArray(prompts), 'prompts:list returns array')

  const profiles = await ipcRendererMock.invoke('profiles:list') as unknown[]
  assert(Array.isArray(profiles), 'profiles:list returns array')

  const mediaProjects = await ipcRendererMock.invoke('media:listProjects') as unknown[]
  assert(Array.isArray(mediaProjects), 'media:listProjects returns array')

  const voicePacks = await ipcRendererMock.invoke('media:listVoicePacks') as unknown[]
  assert(Array.isArray(voicePacks), 'media:listVoicePacks returns array')

  const bridgeStatus = await ipcRendererMock.invoke('bridge:status') as object
  assert(bridgeStatus && typeof bridgeStatus === 'object', 'bridge:status returns object')

  // 5) Test preload.ts API surface
  console.log('\nPreload surface (preload.ts)')
  // preload.ts was required at top level, which called contextBridge.exposeInMainWorld('lkv', api)
  const api = exposedApi as Record<string, unknown>
  assert(api.items !== undefined, 'preload exposes items API')
  assert(api.search !== undefined, 'preload exposes search API')
  assert(api.ask !== undefined, 'preload exposes ask API')
  assert(api.ollama !== undefined, 'preload exposes ollama API')
  assert(api.llm !== undefined, 'preload exposes llm API')
  assert(api.providers !== undefined, 'preload exposes providers API')
  assert(api.plugins !== undefined, 'preload exposes plugins API')
  assert(api.app !== undefined, 'preload exposes app API')
  assert(api.chat !== undefined, 'preload exposes chat API')
  assert(api.import !== undefined, 'preload exposes import API')
  assert(api.prompts !== undefined, 'preload exposes prompts API')
  assert(api.profiles !== undefined, 'preload exposes profiles API')
  assert(api.citationPack !== undefined, 'preload exposes citationPack API')
  assert(api.media !== undefined, 'preload exposes media API')
  assert(api.bridge !== undefined, 'preload exposes bridge API')
  assert(api.mcp !== undefined, 'preload exposes mcp API')

  // Verify a few method signatures
  assert(typeof (api.items as Record<string, unknown>).list === 'function', 'items.list is function')
  assert(typeof (api.search as Record<string, unknown>).query === 'function', 'search.query is function')
  assert(typeof (api.ask as Record<string, unknown>).grounded === 'function', 'ask.grounded is function')
  assert(typeof (api.providers as Record<string, unknown>).list === 'function', 'providers.list is function')
  assert(typeof (api.chat as Record<string, unknown>).send === 'function', 'chat.send is function')
  assert(typeof (api.media as Record<string, unknown>).listProjects === 'function', 'media.listProjects is function')
  assert(typeof (api.mcp as Record<string, unknown>).listServers === 'function', 'mcp.listServers is function')

  // 6) Test main.ts lifecycle hooks
  console.log('\nMain.ts lifecycle hooks')
  assert(typeof mockApp.on === 'function', 'app.on exists')
  assert(appListeners['window-all-closed']?.length > 0, 'window-all-closed handler registered')
  assert(appListeners['before-quit']?.length > 0, 'before-quit handler registered')

  // Cleanup
  try {
    const { stopBridgeServer } = require('../electron/bridge-server')
    stopBridgeServer()
  } catch {}
  closeDb()
  Module._load = origLoad
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true })

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})