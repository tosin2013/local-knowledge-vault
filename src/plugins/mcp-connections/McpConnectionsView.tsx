import { useCallback, useEffect, useState } from 'react'
import { PluginMcpPresetsSection } from '../contrib'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import HubIcon from '@mui/icons-material/Hub'
import AddIcon from '@mui/icons-material/Add'
import type { VaultPluginRenderProps } from '../types'
import type { McpServerSummary, McpToolSummary } from '../../../electron/types'

function statusColor(
  status: McpServerSummary['status']
): 'default' | 'success' | 'warning' | 'error' | 'info' {
  switch (status) {
    case 'connected':
      return 'success'
    case 'authorizing':
      return 'info'
    case 'needs_auth':
      return 'warning'
    case 'error':
      return 'error'
    case 'disconnected':
    default:
      return 'default'
  }
}

function statusLabel(status: McpServerSummary['status']): string {
  switch (status) {
    case 'connected':
      return 'Connected'
    case 'authorizing':
      return 'Waiting for authorization…'
    case 'needs_auth':
      return 'Needs sign-in'
    case 'error':
      return 'Failed'
    case 'disconnected':
    default:
      return 'Disconnected'
  }
}

export function McpConnectionsView({ onClose }: VaultPluginRenderProps) {
  const [servers, setServers] = useState<McpServerSummary[]>([])
  const [toolsById, setToolsById] = useState<Record<string, McpToolSummary[]>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')

  const refresh = useCallback(async () => {
    if (!window.lkv?.mcp?.listServers) {
      setServers([])
      setError('MCP connections IPC unavailable — restart Vault after updating.')
      return
    }
    try {
      const list = await window.lkv.mcp.listServers()
      setServers(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Poll while any server is waiting on the browser OAuth window.
  const anyAuthorizing = servers.some((s) => s.status === 'authorizing') || busyId != null
  useEffect(() => {
    if (!anyAuthorizing) return
    const t = setInterval(() => void refresh(), 1500)
    return () => clearInterval(t)
  }, [anyAuthorizing, refresh])

  const failMessage = (e: unknown): string => {
    const msg = e instanceof Error ? e.message : String(e)
    if (/cancel/i.test(msg)) return 'Sign-in cancelled — click Connect to try again.'
    if (/timed? ?out/i.test(msg)) return 'Sign-in timed out — click Connect to try again.'
    return msg
  }

  const connectNotion = async () => {
    if (!window.lkv?.mcp) return
    setError(null)
    setInfo(null)
    setBusyId('notion')
    try {
      const notion = await window.lkv.mcp.ensureNotion()
      setBusyId(notion.id)
      setInfo('Waiting for authorization… complete sign-in in your browser, or Cancel.')
      await refresh()
      const result = await window.lkv.mcp.connect(notion.id)
      setToolsById((prev) => ({ ...prev, [notion.id]: result.tools }))
      setInfo(
        `Connected${result.server.workspaceId ? ` to workspace ${result.server.workspaceId.slice(0, 8)}…` : ''}. ${result.tools.length} tools available.`
      )
      await refresh()
    } catch (e) {
      setError(failMessage(e))
      setInfo(null)
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  const connectServer = async (id: string) => {
    if (!window.lkv?.mcp) return
    setError(null)
    setInfo(null)
    setBusyId(id)
    try {
      setInfo('Waiting for authorization… complete sign-in in your browser, or Cancel.')
      const result = await window.lkv.mcp.connect(id)
      setToolsById((prev) => ({ ...prev, [id]: result.tools }))
      setInfo(`Connected. ${result.tools.length} tools available.`)
      await refresh()
    } catch (e) {
      setError(failMessage(e))
      setInfo(null)
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  const cancelAuth = async (id: string) => {
    if (!window.lkv?.mcp?.cancelAuth) {
      setError('Cancel is unavailable — restart Vault after updating.')
      return
    }
    try {
      await window.lkv.mcp.cancelAuth(id)
      setInfo(null)
      setError('Sign-in cancelled — click Connect to try again.')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  const disconnectServer = async (id: string) => {
    if (!window.lkv?.mcp) return
    setBusyId(id)
    setError(null)
    try {
      await window.lkv.mcp.disconnect(id)
      setToolsById((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  const removeServer = async (id: string) => {
    if (!window.lkv?.mcp) return
    setBusyId(id)
    setError(null)
    try {
      await window.lkv.mcp.removeServer(id)
      setToolsById((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  const refreshTools = async (id: string) => {
    if (!window.lkv?.mcp) return
    setBusyId(id)
    setError(null)
    try {
      const tools = await window.lkv.mcp.listTools(id)
      setToolsById((prev) => ({ ...prev, [id]: tools }))
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  const submitAdd = async () => {
    if (!window.lkv?.mcp) return
    setError(null)
    try {
      await window.lkv.mcp.addServer({ name: newName.trim(), url: newUrl.trim() })
      setAddOpen(false)
      setNewName('')
      setNewUrl('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const notionServer = servers.find((s) => s.preset === 'notion' || s.id === 'notion')
  const otherServers = servers.filter((s) => s !== notionServer)

  const renderAuthBusy = (id: string, status?: McpServerSummary['status']) => {
    const waiting = status === 'authorizing' || busyId === id
    if (!waiting) return null
    return (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          Waiting for authorization…
        </Typography>
        <Button size="small" color="warning" onClick={() => void cancelAuth(id)}>
          Cancel
        </Button>
      </Stack>
    )
  }

  const retryLabel = (status?: McpServerSummary['status']) => {
    if (status === 'connected') return 'Reconnect'
    if (status === 'error' || status === 'needs_auth') return 'Retry Connect'
    return 'Connect'
  }

  return (
    <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%', overflow: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <HubIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
          MCP connections
        </Typography>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => setAddOpen(true)}
        >
          Add MCP server
        </Button>
        {onClose && (
          <Button size="small" onClick={onClose}>
            Back to Ask
          </Button>
        )}
      </Stack>

      <Typography variant="body2" color="text.secondary">
        Connect Notion (or another MCP server) so Vault can search and update that workspace. Sign-in
        opens in your browser; when it finishes, tools appear below.
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {info && (
        <Alert severity="info" onClose={() => setInfo(null)}>
          {info}
        </Alert>
      )}

      <PluginMcpPresetsSection
        existingUrls={servers.map((s) => s.url)}
        onAdded={() => void refresh()}
        onError={setError}
      />

      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Typography variant="subtitle2" sx={{ flex: 1 }}>
              Notion
            </Typography>
            {notionServer && (
              <Chip
                size="small"
                label={statusLabel(notionServer.status)}
                color={statusColor(notionServer.status)}
              />
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Official Notion MCP · browser sign-in
          </Typography>
          {notionServer?.workspaceId && (
            <Typography variant="caption" color="text.secondary" display="block">
              Workspace: {notionServer.workspaceId}
              {notionServer.emailDomain ? ` · ${notionServer.emailDomain}` : ''}
            </Typography>
          )}
          {notionServer?.error && notionServer.status !== 'connected' && (
            <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
              {notionServer.error}
            </Typography>
          )}
          {notionServer && renderAuthBusy(notionServer.id, notionServer.status)}
        </CardContent>
        <CardActions>
          {notionServer?.status === 'authorizing' || busyId === notionServer?.id || busyId === 'notion' ? (
            <Button
              size="small"
              color="warning"
              onClick={() => void cancelAuth(notionServer?.id || 'notion')}
            >
              Cancel sign-in
            </Button>
          ) : (
            <Button
              variant="contained"
              size="small"
              disabled={busyId !== null}
              onClick={() => void connectNotion()}
              startIcon={
                busyId === 'notion' || busyId === notionServer?.id ? (
                  <CircularProgress size={14} />
                ) : undefined
              }
            >
              {notionServer
                ? `${retryLabel(notionServer.status)}${notionServer.status === 'connected' ? ' Notion' : ''}`
                : 'Connect Notion'}
            </Button>
          )}
          {notionServer?.status === 'connected' && (
            <>
              <Button
                size="small"
                disabled={busyId !== null}
                onClick={() => void disconnectServer(notionServer.id)}
              >
                Disconnect
              </Button>
              <Button
                size="small"
                disabled={busyId !== null}
                onClick={() => void refreshTools(notionServer.id)}
              >
                Refresh tools
              </Button>
            </>
          )}
        </CardActions>
        {notionServer && (toolsById[notionServer.id]?.length || notionServer.toolCount) ? (
          <Box sx={{ px: 2, pb: 2 }}>
            <Divider sx={{ mb: 1 }} />
            <Typography variant="caption" color="text.secondary">
              Tools ({toolsById[notionServer.id]?.length ?? notionServer.toolCount ?? 0})
            </Typography>
            <List dense disablePadding>
              {(toolsById[notionServer.id] ?? []).map((t) => (
                <ListItem key={t.name} disableGutters sx={{ py: 0.25 }}>
                  <ListItemText
                    primary={t.name}
                    secondary={t.description}
                    primaryTypographyProps={{ variant: 'body2', fontFamily: 'monospace' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        ) : null}
      </Card>

      {otherServers.length > 0 && (
        <Typography variant="subtitle2" sx={{ mt: 1 }}>
          Other MCP servers
        </Typography>
      )}

      {otherServers.map((s) => (
        <Card key={s.id} variant="outlined">
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
              <Typography variant="subtitle2" sx={{ flex: 1 }}>
                {s.name}
              </Typography>
              <Chip size="small" label={statusLabel(s.status)} color={statusColor(s.status)} />
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block">
              <code>{s.url}</code>
            </Typography>
            {s.error && s.status !== 'connected' && (
              <Typography variant="caption" color="error" display="block">
                {s.error}
              </Typography>
            )}
            {renderAuthBusy(s.id, s.status)}
          </CardContent>
          <CardActions>
            {s.status === 'authorizing' || busyId === s.id ? (
              <Button size="small" color="warning" onClick={() => void cancelAuth(s.id)}>
                Cancel sign-in
              </Button>
            ) : s.status === 'connected' ? (
              <>
                <Button size="small" disabled={busyId !== null} onClick={() => void disconnectServer(s.id)}>
                  Disconnect
                </Button>
                <Button size="small" disabled={busyId !== null} onClick={() => void refreshTools(s.id)}>
                  Refresh tools
                </Button>
              </>
            ) : (
              <Button
                size="small"
                variant="contained"
                disabled={busyId !== null}
                onClick={() => void connectServer(s.id)}
              >
                {retryLabel(s.status)}
              </Button>
            )}
            <Button size="small" color="error" disabled={busyId !== null} onClick={() => void removeServer(s.id)}>
              Remove
            </Button>
          </CardActions>
          {toolsById[s.id]?.length ? (
            <Box sx={{ px: 2, pb: 2 }}>
              <Divider sx={{ mb: 1 }} />
              <List dense disablePadding>
                {toolsById[s.id].map((t) => (
                  <ListItem key={t.name} disableGutters sx={{ py: 0.25 }}>
                    <ListItemText
                      primary={t.name}
                      secondary={t.description}
                      primaryTypographyProps={{ variant: 'body2', fontFamily: 'monospace' }}
                      secondaryTypographyProps={{ variant: 'caption' }}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          ) : null}
        </Card>
      ))}

      <Alert severity="info" variant="outlined">
        <Typography variant="body2">
          This is the in-app Notion connection. A separate local Bridge (for Obsidian or scripts) is
          optional and unrelated — you do not need Cursor’s connector for Notion here.
        </Typography>
      </Alert>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Add MCP server</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              fullWidth
              size="small"
              placeholder="My MCP server"
            />
            <TextField
              label="URL (Streamable HTTP)"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              fullWidth
              size="small"
              placeholder="https://example.com/mcp"
              helperText="Remote MCP endpoint. OAuth is used when the server advertises it."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!newName.trim() || !newUrl.trim()}
            onClick={() => void submitAdd()}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
