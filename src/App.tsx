import { useEffect, useRef, useState } from 'react'
import { Box, CssBaseline, Paper, ThemeProvider, Typography } from '@mui/material'
import { listPlugins } from './plugins/registry'
import { ProviderDialog } from './components/ai/ProviderDialog'
import { aiChipLabel } from './components/ai/FirstRunLocalCard'
import { personalityDisplayName, AI_DRAFT_STATUS, provenanceHeader, type Mode } from './domain'
import { useUi } from './hooks/useUi'
import { useProviders } from './hooks/useProviders'
import { useNotes } from './hooks/useNotes'
import { usePrompts } from './hooks/usePrompts'
import { useChat } from './hooks/useChat'
import { TopBar } from './features/TopBar'
import { NotesRail } from './features/NotesRail'
import { FindPanel } from './features/FindPanel'
import { ChatView } from './features/ChatView'
import { PromptsView } from './features/PromptsView'
import { NotePeek } from './features/NotePeek'
import { AiSettingsDialog } from './features/AiSettingsDialog'
import { ContentChrome } from './features/ContentChrome'
import { ManageProjectsDialog } from './features/ManageProjectsDialog'

export default function App() {
  // Cross-cutting navigation / notification state.
  const [mode, setMode] = useState<Mode>('chat')
  const [activePluginId, setActivePluginId] = useState<string | null>(null)
  const [pluginsMenuAnchor, setPluginsMenuAnchor] = useState<null | HTMLElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [manageProjectsOpen, setManageProjectsOpen] = useState(false)

  // Focus targets for the app menu / keyboard shortcuts (⌘F search, ⌘K ask).
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const composerRef = useRef<HTMLInputElement | null>(null)

  const ui = useUi()
  const providers = useProviders()

  // Late-bound so usePrompts (which runs before useChat) can reach the chat-owned
  // "re-pick profile after a prompt is deleted" handler.
  const onPromptDeletedRef = useRef<(deletedId: string) => void>(() => {})

  const notes = useNotes({
    setBusy,
    setError,
    setStatusMsg,
    advanced: ui.advanced,
    setMode,
  })
  const prompts = usePrompts({
    setBusy,
    advanced: ui.advanced,
    setMode,
    onPromptDeleted: (deletedId) => onPromptDeletedRef.current(deletedId),
  })
  const chat = useChat({
    prompts: prompts.prompts,
    filters: notes.filters,
    setFilters: notes.setFilters,
    setBusy,
    setError,
    setStatusMsg,
    setMode,
    advanced: ui.advanced,
    busy,
  })
  onPromptDeletedRef.current = chat.handlePromptDeleted

  const hasApi = typeof window !== 'undefined' && !!window.lkv

  useEffect(() => {
    if (!hasApi) return
    void notes.refreshList()
    void notes.refreshProjects()
    void providers.refreshLlm()
    void chat.refreshSessions()
    void prompts.refreshPrompts()
    void chat.refreshProfiles()
    const t = setInterval(() => void providers.refreshLlm(), 15000)
    return () => clearInterval(t)
  }, [
    hasApi,
    notes.refreshList,
    notes.refreshProjects,
    providers.refreshLlm,
    chat.refreshSessions,
    prompts.refreshPrompts,
    chat.refreshProfiles,
  ])

  // When left-rail filters change while Find is showing an active query, re-run search.
  useEffect(() => {
    if (mode !== 'search') return
    if (!notes.searchText.trim() && !notes.filters.para && !notes.filters.kind && !notes.filters.status && !notes.filters.project) {
      return
    }
    // Always re-query when filters change in Find mode (including empty text + filters only).
    const t = setTimeout(() => {
      void notes.runSearch()
    }, 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only filters/mode, not every searchText keystroke
  }, [notes.filters.para, notes.filters.kind, notes.filters.status, notes.filters.project, mode])

  // Simple mode hides the Personalities (prompts) pane.
  useEffect(() => {
    if (!ui.advanced && mode === 'prompts') setMode('chat')
  }, [ui.advanced, mode])

  /** Jump to Ask (chat) tab, optionally prefill from top search. */
  const goAskAi = () => {
    if (notes.searchText.trim()) {
      chat.setChatInput(notes.searchText.trim())
    }
    setMode('chat')
  }

  // Latest handlers so the one-time menu subscription never goes stale.
  const newNoteRef = useRef(notes.onNewNote)
  newNoteRef.current = notes.onNewNote

  // Application menu accelerators (⌘N new note, ⌘F find, ⌘K ask).
  useEffect(() => {
    if (!window.lkv?.app?.onMenuAction) return
    return window.lkv.app.onMenuAction((action) => {
      if (action === 'new-note') {
        newNoteRef.current()
      } else if (action === 'find') {
        searchInputRef.current?.focus()
      } else if (action === 'ask') {
        setMode('chat')
        window.setTimeout(() => composerRef.current?.focus(), 0)
      }
    })
  }, [])

  const aiReady = providers.llmStatus?.active != null
  const aiStatusText = aiChipLabel(providers.llmStatus, ui.advanced)
  const showFirstRun = !!providers.llmStatus?.needsSetup
  const showSmallHint = !!providers.llmStatus?.active?.smallModel && !providers.smallHintDismissed
  const visiblePlugins = listPlugins().filter((p) => !providers.disabledPlugins.includes(p.id))
  const quickAsks = providers.pluginContribs.promptPacks.flatMap((pack) =>
    pack.prompts.slice(0, 6).map((q) => ({ q, pack: pack.name })),
  ).slice(0, 8)

  if (!hasApi) {
    return (
      <ThemeProvider theme={ui.muiTheme}>
        <CssBaseline />
        <Box
          sx={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 4,
            bgcolor: 'background.default',
          }}
        >
          <Paper sx={{ p: 4, maxWidth: 420, borderRadius: 5, textAlign: 'center' }}>
            <Typography variant="h5" color="primary" fontWeight={600} gutterBottom>
              Vault
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Run inside Electron (`npm run dev`) so the preload API is available.
            </Typography>
          </Paper>
        </Box>
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider theme={ui.muiTheme}>
      <CssBaseline />
      <Box className={`app ${ui.advanced ? 'ui-advanced' : 'ui-simple'}`} sx={{ bgcolor: 'background.default' }}>
        <TopBar
          advanced={ui.advanced}
          mode={mode}
          activePluginId={activePluginId}
          pluginsMenuAnchor={pluginsMenuAnchor}
          visiblePlugins={visiblePlugins}
          aiStatusText={aiStatusText}
          llmStatus={providers.llmStatus}
          aiReady={aiReady}
          theme={ui.theme}
          searchText={notes.searchText}
          busy={busy}
          searchInputRef={searchInputRef}
          onSearchText={notes.setSearchText}
          onRunSearch={() => void notes.runSearch()}
          onAiSettings={() => providers.setAiSettingsOpen(true)}
          onRecheck={() => void providers.recheckLlm()}
          onPersonalities={() => {
            setActivePluginId(null)
            setMode('prompts')
          }}
          onPluginsMenu={setPluginsMenuAnchor}
          onSelectPlugin={(id) => {
            setPluginsMenuAnchor(null)
            setActivePluginId(id)
            setMode('chat')
          }}
          onAdvanced={(v) => ui.setUiModePersist(v ? 'advanced' : 'simple')}
          onTheme={() => ui.setThemePersist(ui.theme === 'blink' ? 'blink-light' : 'blink')}
        />

        <Box className="main">
          <NotesRail
            advanced={ui.advanced}
            items={notes.visibleItems}
            selectedId={notes.selectedId}
            filters={notes.filters}
            projectOptions={notes.projectOptions}
            filterSummary={notes.filterSummary}
            filtersOpen={notes.filtersOpen}
            importUrl={notes.importUrl}
            importBusy={notes.importBusy}
            busy={busy}
            railQuery={notes.railQuery}
            railSort={notes.railSort}
            showTranscripts={notes.showTranscripts}
            onNewNote={notes.onNewNote}
            onImportUrl={notes.setImportUrl}
            onImport={() => void notes.onImportFromUrl()}
            onProject={chat.onNotesFromChange}
            onManageProjects={() => setManageProjectsOpen(true)}
            onDeleteItem={(id) => void notes.deleteItemById(id)}
            onRailQuery={notes.setRailQuery}
            onRailSort={notes.setRailSort}
            onShowTranscripts={notes.setShowTranscripts}
            onFilters={notes.setFilters}
            onFiltersOpen={notes.setFiltersOpen}
            onSelect={notes.selectItem}
          />

          <Box
            component="section"
            className="content"
            sx={{ bgcolor: 'background.default', position: 'relative' }}
          >
            <ContentChrome
              mode={mode}
              activePluginId={activePluginId}
              statusMsg={statusMsg}
              error={error}
              onToggleMode={(v) => {
                setActivePluginId(null)
                setMode(v)
              }}
              onClearPlugin={() => setActivePluginId(null)}
              onClosePlugin={() => {
                setActivePluginId(null)
                setMode('chat')
              }}
              onDismissStatus={() => setStatusMsg(null)}
              onDismissError={() => setError(null)}
              onOpenNote={(id) => notes.selectItem(id)}
              onNewDraft={notes.openPrefilledDraft}
            />

            {!activePluginId && mode === 'search' && (
              <FindPanel
                advanced={ui.advanced}
                askResult={notes.askResult}
                hits={notes.hits}
                searchText={notes.searchText}
                filters={notes.filters}
                filterSummary={notes.filterSummary}
                hasMore={notes.hasMore}
                onSelect={notes.selectItem}
                onAskInstead={goAskAi}
                onShowMore={notes.loadMoreHits}
              />
            )}

            {!activePluginId && mode === 'chat' && (
              <ChatView
                advanced={ui.advanced}
                busy={busy}
                llmStatus={providers.llmStatus}
                llmChecking={providers.llmChecking}
                showFirstRun={showFirstRun}
                showSmallHint={showSmallHint}
                askEmpty={chat.askEmpty}
                quickAsks={quickAsks}
                messages={chat.messages}
                chatOffline={chat.chatOffline}
                threadEndRef={chat.threadEndRef}
                selectedProfileId={chat.selectedProfileId}
                userProfiles={chat.userProfiles}
                selectedUserProfile={chat.selectedUserProfile}
                prompts={prompts.prompts}
                selectedPromptId={chat.selectedPromptId}
                projectOptions={notes.projectOptions}
                notesFrom={notes.filters.project ?? ''}
                profileRenameOpen={chat.profileRenameOpen}
                profileRenameName={chat.profileRenameName}
                profileSaveOpen={chat.profileSaveOpen}
                profileSaveName={chat.profileSaveName}
                profileBusy={chat.profileBusy}
                askCustomizeOpen={chat.askCustomizeOpen}
                filterSummary={notes.filterSummary}
                stayingInGorgias={chat.stayingInGorgias}
                scopeCoupleHint={chat.scopeCoupleHint}
                chatInput={chat.chatInput}
                chatPlaceholder={chat.chatPlaceholder}
                composerRef={composerRef}
                sessions={chat.sessions}
                activeSessionId={chat.activeSessionId}
                onRecheck={() => void providers.recheckLlm()}
                onAddProvider={providers.openAddProvider}
                onEditProvider={(p) => {
                  providers.setEditingProvider(p)
                  providers.setProviderDialogOpen(true)
                }}
                onError={setError}
                onDismissSmallHint={() => providers.setSmallHintDismissed(true)}
                onChatInput={chat.setChatInput}
                onSelectNote={notes.selectItem}
                onProfileChange={chat.onProfileChange}
                onOpenRename={() => {
                  if (chat.selectedUserProfile) {
                    chat.setProfileRenameName(chat.selectedUserProfile.name)
                    chat.setProfileRenameOpen(true)
                    chat.setProfileSaveOpen(false)
                  }
                }}
                onRenameName={chat.setProfileRenameName}
                onRename={() => void chat.onRenameProfile()}
                onRenameCancel={() => chat.setProfileRenameOpen(false)}
                onDeleteProfile={() => void chat.onDeleteProfile()}
                onAskCustomize={chat.setAskCustomizeOpen}
                onChatPrompt={chat.onChatPromptChange}
                onNotesFrom={chat.onNotesFromChange}
                onOpenProfileSave={() => {
                  const prompt = prompts.prompts.find((p) => p.id === chat.selectedPromptId)
                  const persona = prompt ? personalityDisplayName(prompt) : 'Custom'
                  const proj = (notes.filters.project ?? '').trim()
                  chat.setProfileSaveName(proj ? `${persona} · ${proj}` : persona)
                  chat.setProfileSaveOpen(true)
                  chat.setProfileRenameOpen(false)
                }}
                onProfileSaveName={chat.setProfileSaveName}
                onSaveAsProfile={() => void chat.onSaveAsProfile()}
                onProfileSaveCancel={() => chat.setProfileSaveOpen(false)}
                onSend={() => void chat.onSendChat()}
                onNewChat={() => void chat.onNewChat()}
                onExportCitationPack={() => void chat.onExportCitationPack()}
                onSaveAsNote={(content, cites) => {
                  const title = (content.trim().split(/[?!.\n]/)[0] || 'Saved answer').slice(0, 60)
                  notes.openPrefilledDraft({
                    title,
                    body: provenanceHeader({ citedIds: cites.map((c) => c.id) }) + content,
                    kind: 'note',
                    para: 'resources',
                    status: AI_DRAFT_STATUS,
                    project: notes.filters.project ?? null,
                  })
                }}
                onSelectSession={(id) => void chat.onSelectSession(id)}
                onDeleteSession={(id) => void chat.onDeleteSession(id)}
              />
            )}

            {!activePluginId && mode === 'prompts' && (
              <PromptsView
                advanced={ui.advanced}
                busy={busy}
                prompts={prompts.prompts}
                editingPrompt={prompts.editingPrompt}
                promptBodyOpen={prompts.promptBodyOpen}
                promptDraft={prompts.promptDraft}
                promptDirty={prompts.promptDirty}
                onNewPrompt={prompts.onNewPrompt}
                onSelectPrompt={prompts.onSelectPrompt}
                onDraft={prompts.setPromptDraft}
                onDirty={prompts.setPromptDirty}
                onBodyOpen={prompts.setPromptBodyOpen}
                onUseInAsk={(promptId) => {
                  chat.onChatPromptChange(promptId)
                  setMode('chat')
                }}
                onDeletePrompt={() => void prompts.onDeletePrompt()}
                onSavePrompt={() => void prompts.onSavePrompt()}
              />
            )}

            <NotePeek
              open={notes.notePeekOpen}
              isNewDraft={notes.isNewDraft}
              draft={notes.draft}
              peekEditing={notes.peekEditing}
              dirty={notes.dirty}
              busy={busy}
              advanced={ui.advanced}
              projectOptions={notes.projectOptions}
              onClose={notes.closeNotePeek}
              onEdit={notes.setPeekEditing}
              onPatch={notes.patchDraft}
              onSave={() => void notes.onSave()}
              onDelete={() => void notes.onDelete()}
              onConfirmDraft={() => void notes.confirmDraft()}
              onCopyId={(id) => void notes.copyItemId(id)}
            />
          </Box>
        </Box>

        <ManageProjectsDialog
          open={manageProjectsOpen}
          projects={notes.projects}
          busy={busy}
          onClose={() => setManageProjectsOpen(false)}
          onRename={(from, to) => void notes.renameProject(from, to)}
          onMerge={(from, into) => void notes.mergeProject(from, into)}
          onDelete={(name) => void notes.deleteProject(name)}
        />

        <ProviderDialog
          open={providers.providerDialogOpen}
          presets={providers.providerPresets}
          editing={providers.editingProvider}
          initialPresetId={providers.providerInitialPreset}
          onClose={() => providers.setProviderDialogOpen(false)}
          onSaved={(cfg) => {
            providers.setProviderDialogOpen(false)
            setStatusMsg(`Saved provider “${cfg.label}”.`)
            void providers.recheckLlm()
          }}
        />
        <AiSettingsDialog
          open={providers.aiSettingsOpen}
          advanced={ui.advanced}
          llmStatus={providers.llmStatus}
          llmChecking={providers.llmChecking}
          onClose={() => providers.setAiSettingsOpen(false)}
          onRefresh={() => void providers.recheckLlm()}
          onAddProvider={providers.openAddProvider}
          onEditProvider={(p) => {
            providers.setEditingProvider(p)
            providers.setProviderDialogOpen(true)
          }}
          onError={setError}
          onUseAdvanced={() => ui.setUiModePersist('advanced')}
        />
      </Box>
    </ThemeProvider>
  )
}
