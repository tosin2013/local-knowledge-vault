import type { RefObject } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import AddIcon from '@mui/icons-material/Add'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import FileDownloadIcon from '@mui/icons-material/FileDownload'
import type {
  ChatMessage,
  ChatProfile,
  ChatSession,
  Citation,
  LlmStatus,
  Prompt,
  ProviderConfig,
} from '../../electron/types'
import { AnswerText } from '../components/answer/AnswerText'
import {
  findGroundedDefaultPrompt,
  isBuiltinProfileId,
  listBuiltinProfiles,
  parseCitations,
  personalityDisplayName,
  type ChatProfileId,
} from '../domain'
import { FirstRunLocalCard, SmallModelHint } from '../components/ai/FirstRunLocalCard'
import { ProvidersPanel } from '../components/ai/ProvidersPanel'
import { AnswerProviderChip } from '../components/ai/AnswerProviderChip'

export interface ChatViewProps {
  advanced: boolean
  busy: boolean
  sending: boolean
  llmStatus: LlmStatus | null
  llmChecking: boolean
  showFirstRun: boolean
  showSmallHint: boolean
  askEmpty: { title: string; body: string }
  quickAsks: Array<{ q: string; pack: string }>
  messages: ChatMessage[]
  chatOffline: boolean
  threadEndRef: RefObject<HTMLDivElement | null>
  // Profile state
  selectedProfileId: ChatProfileId
  userProfiles: ChatProfile[]
  selectedUserProfile: ChatProfile | undefined
  prompts: Prompt[]
  selectedPromptId: string
  projectOptions: string[]
  notesFrom: string
  profileRenameOpen: boolean
  profileRenameName: string
  profileSaveOpen: boolean
  profileSaveName: string
  profileBusy: boolean
  askCustomizeOpen: boolean
  filterSummary: string
  stayingInGorgias: boolean
  scopeCoupleHint: string | null
  chatInput: string
  chatPlaceholder: string
  composerRef?: RefObject<HTMLInputElement | null>
  sessions: ChatSession[]
  activeSessionId: string | null
  // Callbacks
  onRecheck: () => void
  onAddProvider: (presetId?: string) => void
  onEditProvider: (p: ProviderConfig) => void
  onError: (m: string) => void
  onDismissSmallHint: () => void
  onChatInput: (v: string) => void
  onSelectNote: (id: string) => void
  onProfileChange: (profileId: string) => void
  onOpenRename: () => void
  onRenameName: (v: string) => void
  onRename: () => void
  onRenameCancel: () => void
  onDeleteProfile: () => void
  onAskCustomize: (open: boolean) => void
  onChatPrompt: (promptId: string) => void
  onNotesFrom: (project: string) => void
  onOpenProfileSave: () => void
  onProfileSaveName: (v: string) => void
  onSaveAsProfile: () => void
  onProfileSaveCancel: () => void
  onSend: () => void
  onNewChat: () => void
  onExportCitationPack: () => void
  onSaveAsNote: (content: string, cites: Citation[]) => void
  onSelectSession: (id: string) => void
  onDeleteSession: (id: string) => void
}

export function ChatView(props: ChatViewProps) {
  const {
    advanced,
    busy,
    sending,
    llmStatus,
    llmChecking,
    showFirstRun,
    showSmallHint,
    askEmpty,
    quickAsks,
    messages,
    chatOffline,
    threadEndRef,
    selectedProfileId,
    userProfiles,
    selectedUserProfile,
    prompts,
    selectedPromptId,
    projectOptions,
    notesFrom,
    profileRenameOpen,
    profileRenameName,
    profileSaveOpen,
    profileSaveName,
    profileBusy,
    askCustomizeOpen,
    filterSummary,
    stayingInGorgias,
    scopeCoupleHint,
    chatInput,
    chatPlaceholder,
    composerRef,
    sessions,
    activeSessionId,
    onRecheck,
    onAddProvider,
    onEditProvider,
    onError,
    onDismissSmallHint,
    onChatInput,
    onSelectNote,
    onProfileChange,
    onOpenRename,
    onRenameName,
    onRename,
    onRenameCancel,
    onDeleteProfile,
    onAskCustomize,
    onChatPrompt,
    onNotesFrom,
    onOpenProfileSave,
    onProfileSaveName,
    onSaveAsProfile,
    onProfileSaveCancel,
    onSend,
    onNewChat,
    onExportCitationPack,
    onSaveAsNote,
    onSelectSession,
    onDeleteSession,
  } = props

  return (
    <Box className="chat-layout">
      <Box className="chat-main">
        {advanced && llmStatus && (
          <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
            <details>
              <summary
                style={{
                  cursor: 'pointer',
                  padding: '8px 12px',
                  fontSize: 12,
                  listStyle: 'none',
                }}
              >
                AI providers
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  · {llmStatus.message}
                </Typography>
              </summary>
              <Box sx={{ px: 1.5, pb: 1.5 }}>
                <ProvidersPanel
                  status={llmStatus}
                  checking={llmChecking}
                  onRefresh={onRecheck}
                  onAdd={onAddProvider}
                  onEdit={onEditProvider}
                  onError={onError}
                />
              </Box>
            </details>
          </Box>
        )}

        <Box
          className="chat-thread"
          aria-live="polite"
          sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, bgcolor: 'background.default' }}
        >
          {showFirstRun && llmStatus && (
            <FirstRunLocalCard
              status={llmStatus}
              checking={llmChecking}
              onRecheck={onRecheck}
              onUseCloud={() => onAddProvider('openrouter')}
            />
          )}
          {showSmallHint && llmStatus?.active && (
            <SmallModelHint
              active={llmStatus.active}
              recommended={llmStatus.recommendedLocalModel?.name}
              onDismiss={onDismissSmallHint}
            />
          )}
          {messages.length === 0 && !showFirstRun && (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Paper sx={{ p: 4, maxWidth: 520, textAlign: 'center', borderRadius: 5 }}>
                <Typography variant="h6" color="primary" gutterBottom>
                  {askEmpty.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {askEmpty.body}
                </Typography>
                {quickAsks.length > 0 && (
                  <Stack direction="row" flexWrap="wrap" gap={0.75} justifyContent="center" sx={{ mt: 2 }} data-testid="quick-asks">
                    {quickAsks.map(({ q, pack }) => (
                      <Chip
                        key={`${pack}:${q}`}
                        size="small"
                        variant="outlined"
                        label={q.length > 60 ? q.slice(0, 57) + '…' : q}
                        title={`${q} — from “${pack}”`}
                        onClick={() => onChatInput(q)}
                      />
                    ))}
                  </Stack>
                )}
              </Paper>
            </Box>
          )}
          {messages.map((m) => {
            const cites = m.role === 'assistant' ? parseCitations(m.citations_json) : []
            const isUser = m.role === 'user'
            const isSystem = m.role === 'system'
            return (
              <Box
                key={m.id}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isUser ? 'flex-end' : 'flex-start',
                  opacity: isSystem ? 0.85 : 1,
                }}
              >
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.25, textTransform: 'capitalize' }}>
                  {m.role}
                </Typography>
                <Paper
                  sx={{
                    px: 2,
                    py: 1.25,
                    maxWidth: '85%',
                    borderRadius: 4,
                    bgcolor: isUser
                      ? 'primary.main'
                      : isSystem
                        ? 'action.selected'
                        : 'background.paper',
                    color: isUser ? 'primary.contrastText' : 'text.primary',
                    border: isUser ? 0 : 1,
                    borderColor: 'divider',
                  }}
                >
                  {m.role === 'assistant' ? (
                    <AnswerText text={m.content} citations={cites} onSelectCitation={onSelectNote} />
                  ) : (
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                      {m.content}
                    </Typography>
                  )}
                  {cites.length > 0 && (
                    <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 1 }}>
                      {cites.map((c, i) => (
                        <Chip
                          key={c.id}
                          size="small"
                          label={`[${i + 1}] ${c.title}`}
                          color="primary"
                          variant={isUser ? 'filled' : 'outlined'}
                          onClick={() => onSelectNote(c.id)}
                          title={advanced ? c.id : c.project && !c.title.includes(c.project) ? `${c.title} — ${c.project}` : c.title}
                          sx={isUser ? { bgcolor: 'rgba(255,255,255,0.2)', color: 'inherit' } : undefined}
                        />
                      ))}
                    </Stack>
                  )}
                  {m.role === 'assistant' && <AnswerProviderChip providerJson={m.provider_json} />}
                  {m.role === 'assistant' && (
                    <Button
                      size="small"
                      sx={{ mt: 1, ml: -0.5 }}
                      onClick={() => onSaveAsNote(m.content, cites)}
                    >
                      Save as note
                    </Button>
                  )}
                </Paper>
              </Box>
            )
          })}
          {sending && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.25, textTransform: 'capitalize' }}>
                assistant
              </Typography>
              <Paper
                sx={{
                  px: 2,
                  py: 1.25,
                  borderRadius: 4,
                  bgcolor: 'background.paper',
                  border: 1,
                  borderColor: 'divider',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                }}
                data-testid="answering-indicator"
              >
                <CircularProgress size={14} />
                <Typography variant="body2" color="text.secondary">
                  Answering from your notes…
                </Typography>
              </Paper>
            </Box>
          )}
          {chatOffline && (
            <Alert severity="warning">
              AI unavailable — your message was saved; reply is a status notice.
            </Alert>
          )}
          <div ref={threadEndRef} />
        </Box>

        <Paper
          square
          className="chat-composer"
          sx={{
            borderTop: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            p: 1.5,
            borderRadius: 0,
            flexShrink: 0,
          }}
        >
          <Stack spacing={1.25}>
            <Stack direction="row" spacing={1} alignItems="flex-end" flexWrap="wrap">
              <FormControl size="small" sx={{ flex: 1, minWidth: 192, maxWidth: 320 }}>
                <InputLabel id="chat-profile-label">Profile</InputLabel>
                <Select
                  labelId="chat-profile-label"
                  label="Profile"
                  value={
                    selectedProfileId === 'custom' ||
                    isBuiltinProfileId(selectedProfileId) ||
                    userProfiles.some((p) => p.id === selectedProfileId)
                      ? selectedProfileId
                      : 'custom'
                  }
                  onChange={(e) => onProfileChange(String(e.target.value))}
                  aria-label="Chat profile"
                >
                  {listBuiltinProfiles(prompts).map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.name}
                    </MenuItem>
                  ))}
                  {userProfiles.map((p) => {
                    const broken = !prompts.some((pr) => pr.id === p.prompt_id)
                    return (
                      <MenuItem key={p.id} value={p.id}>
                        {broken ? `${p.name} (broken)` : p.name}
                      </MenuItem>
                    )
                  })}
                  <MenuItem value="custom">Custom</MenuItem>
                </Select>
              </FormControl>
              {selectedUserProfile && !profileRenameOpen && (
                <Stack direction="row" spacing={0.5} sx={{ pb: 0.25 }}>
                  <Button
                    size="small"
                    disabled={profileBusy}
                    onClick={onOpenRename}
                  >
                    Rename
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    disabled={profileBusy}
                    onClick={onDeleteProfile}
                  >
                    Delete
                  </Button>
                </Stack>
              )}
              <Button
                size="small"
                variant="outlined"
                aria-expanded={askCustomizeOpen}
                onClick={() => onAskCustomize(!askCustomizeOpen)}
                endIcon={askCustomizeOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              >
                Customize
              </Button>
              {advanced && (
                <Typography variant="caption" color="text.secondary" sx={{ pb: 1, whiteSpace: 'nowrap' }}>
                  {filterSummary}
                </Typography>
              )}
            </Stack>

            {profileRenameOpen && selectedUserProfile && (
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <TextField
                  size="small"
                  sx={{ flex: 1, minWidth: 160 }}
                  value={profileRenameName}
                  onChange={(e) => onRenameName(e.target.value)}
                  placeholder="Profile name"
                  aria-label="Rename profile"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      onRename()
                    }
                    if (e.key === 'Escape') onRenameCancel()
                  }}
                  autoFocus
                />
                <Button
                  variant="contained"
                  size="small"
                  disabled={profileBusy || !profileRenameName.trim()}
                  onClick={onRename}
                >
                  Save
                </Button>
                <Button size="small" disabled={profileBusy} onClick={onRenameCancel}>
                  Cancel
                </Button>
              </Stack>
            )}

            {(stayingInGorgias || scopeCoupleHint) && (
              <Typography variant="caption" color="text.secondary">
                {stayingInGorgias ? 'Staying in Gorgias notes' : scopeCoupleHint}
              </Typography>
            )}

            <Collapse in={askCustomizeOpen}>
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3 }}>
                <Stack spacing={1.25}>
                  {scopeCoupleHint && (
                    <Typography variant="caption" color="text.secondary">
                      {scopeCoupleHint}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap">
                    <FormControl size="small" sx={{ flex: 1, minWidth: 160 }}>
                      <InputLabel id="personality-label">Personality</InputLabel>
                      <Select
                        labelId="personality-label"
                        label="Personality"
                        value={selectedPromptId || findGroundedDefaultPrompt(prompts)?.id || ''}
                        onChange={(e) => onChatPrompt(String(e.target.value))}
                      >
                        {prompts.map((p) => (
                          <MenuItem key={p.id} value={p.id}>
                            {personalityDisplayName(p)}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ flex: 1, minWidth: 160 }}>
                      <InputLabel id="notes-from-label">Project</InputLabel>
                      <Select
                        labelId="notes-from-label"
                        label="Project"
                        value={notesFrom}
                        onChange={(e) => onNotesFrom(String(e.target.value))}
                      >
                        <MenuItem value="">All</MenuItem>
                        {projectOptions.map((name) => (
                          <MenuItem key={name} value={name}>
                            {name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Stack>
                  <Divider />
                  {!profileSaveOpen ? (
                    <Button
                      size="small"
                      disabled={profileBusy}
                      onClick={onOpenProfileSave}
                      sx={{ alignSelf: 'flex-start' }}
                    >
                      Save as profile…
                    </Button>
                  ) : (
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <TextField
                        size="small"
                        sx={{ flex: 1, minWidth: 160 }}
                        value={profileSaveName}
                        onChange={(e) => onProfileSaveName(e.target.value)}
                        placeholder="Profile name"
                        aria-label="New profile name"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            onSaveAsProfile()
                          }
                          if (e.key === 'Escape') onProfileSaveCancel()
                        }}
                        autoFocus
                      />
                      <Button
                        variant="contained"
                        size="small"
                        disabled={profileBusy || !profileSaveName.trim()}
                        onClick={onSaveAsProfile}
                      >
                        Save
                      </Button>
                      <Button size="small" disabled={profileBusy} onClick={onProfileSaveCancel}>
                        Cancel
                      </Button>
                    </Stack>
                  )}
                </Stack>
              </Paper>
            </Collapse>

            <Stack direction="row" spacing={1} alignItems="flex-end">
              <TextField
                fullWidth
                multiline
                minRows={3}
                maxRows={8}
                value={chatInput}
                inputRef={composerRef}
                onChange={(e) => onChatInput(e.target.value)}
                placeholder={chatPlaceholder}
                aria-label="Ask a question"
                disabled={busy || sending}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    onSend()
                  }
                }}
              />
              <IconButton
                color="primary"
                disabled={busy || sending || !chatInput.trim()}
                onClick={onSend}
                aria-label={busy || sending ? 'Sending' : 'Send'}
                sx={{
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  borderRadius: 4,
                  width: 48,
                  height: 48,
                  '&:hover': { bgcolor: 'primary.dark' },
                  '&.Mui-disabled': { bgcolor: 'action.disabledBackground' },
                }}
              >
                <SendIcon />
              </IconButton>
            </Stack>
          </Stack>
        </Paper>
      </Box>

      <Paper
        component="aside"
        className="chat-sessions"
        square
        sx={{ bgcolor: 'background.paper', borderLeft: 1, borderColor: 'divider', borderRadius: 0 }}
      >
        <Stack spacing={1} sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Button
            fullWidth
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={onNewChat}
          >
            New chat
          </Button>
          {advanced ? (
            <Button
              fullWidth
              size="small"
              variant="outlined"
              startIcon={<FileDownloadIcon />}
              disabled={busy || !activeSessionId || messages.length === 0}
              onClick={onExportCitationPack}
              aria-label="Export citation pack"
            >
              Export citation pack
            </Button>
          ) : (
            <Button
              fullWidth
              size="small"
              variant="outlined"
              startIcon={<FileDownloadIcon />}
              disabled={busy || !activeSessionId || messages.length === 0}
              onClick={onExportCitationPack}
              aria-label="Export citation pack"
            >
              Export citation pack
            </Button>
          )}
          <Typography variant="caption" color="text.secondary">
            Answers from your notes
          </Typography>
        </Stack>
        <Box className="session-list" sx={{ p: 1 }}>
          {sessions.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', p: 1.5 }}>
              No chats yet.
            </Typography>
          )}
          <List dense disablePadding>
            {sessions.map((s) => (
              <ListItemButton
                key={s.id}
                selected={activeSessionId === s.id}
                onClick={() => onSelectSession(s.id)}
                sx={{
                  mb: 0.25,
                  borderRadius: 3,
                  borderLeft: activeSessionId === s.id ? 3 : 0,
                  borderColor: 'primary.main',
                  pr: 0.5,
                }}
              >
                <ListItemText
                  primary={s.title}
                  primaryTypographyProps={{ variant: 'body2', fontWeight: 600, noWrap: true }}
                />
                <IconButton
                  size="small"
                  aria-label="Delete session"
                  title="Delete session"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteSession(s.id)
                  }}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Paper>
    </Box>
  )
}
