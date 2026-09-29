import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import ExtensionIcon from '@mui/icons-material/Extension'
import RefreshIcon from '@mui/icons-material/Refresh'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RestoreIcon from '@mui/icons-material/Restore'
import AddIcon from '@mui/icons-material/Add'
import type { PluginCloudProvider, PluginInfo, PluginListResult, PluginPreview, RemovedPlugin } from '../../../electron/types'
import type { VaultPluginRenderProps } from '../types'
import { notifyPluginsChanged } from '../contrib'
import { describeAdds, cloudDomains } from '../describe'

const cleanErr = (e: unknown) =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)

const AUTHORS_DOC = 'https://github.com/tosin2013/local-knowledge-vault/blob/main/docs/plugins-authoring.md'

/** Add-ons: install, preview/consent, enable/remove and restore declarative plugin packs. */
export function ManagePluginsView({ onClose }: VaultPluginRenderProps) {
  const [data, setData] = useState<PluginListResult | null>(null)
  const [bundled, setBundled] = useState<PluginPreview[]>([])
  const [removed, setRemoved] = useState<RemovedPlugin[]>([])
  const [busy, setBusy] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [preview, setPreview] = useState<PluginPreview | null>(null)

  const refresh = useCallback(async () => {
    setData(await window.lkv.plugins.list())
    if (window.lkv.plugins.listBundled) setBundled(await window.lkv.plugins.listBundled())
    if (window.lkv.plugins.listRemoved) setRemoved(await window.lkv.plugins.listRemoved())
  }, [])

  useEffect(() => {
    void refresh().catch((e) => setError(cleanErr(e)))
  }, [refresh])

  const pickAndPreview = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await window.lkv.plugins.preview()
      if (r.canceled) return
      if (r.errors) {
        setError(r.errors.join(' '))
        return
      }
      if (r.preview) setPreview(r.preview)
    } catch (e) {
      setError(cleanErr(e))
    } finally {
      setBusy(false)
    }
  }

  const doInstall = async (p: PluginPreview) => {
    setInstalling(true)
    setError(null)
    try {
      const r = await window.lkv.plugins.installFromPath(p.sourcePath)
      if (!r.ok) {
        setError((r.errors ?? ['Install failed']).join(' '))
      } else {
        setInfo(`Installed “${r.plugin?.name ?? p.name}”.`)
      }
      setPreview(null)
      await refresh()
      notifyPluginsChanged()
    } catch (e) {
      setError(cleanErr(e))
    } finally {
      setInstalling(false)
    }
  }

  const doRemove = async (p: PluginInfo) => {
    if (!window.confirm(`Remove “${p.name}”? It moves to Removed, where you can restore it.`)) return
    setBusy(true)
    setError(null)
    try {
      await window.lkv.plugins.remove(p.id)
      await refresh()
      notifyPluginsChanged()
    } catch (e) {
      setError(cleanErr(e))
    } finally {
      setBusy(false)
    }
  }

  const doRestore = async (key: string) => {
    setBusy(true)
    setError(null)
    try {
      await window.lkv.plugins.restore(key)
      await refresh()
      notifyPluginsChanged()
    } catch (e) {
      setError(cleanErr(e))
    } finally {
      setBusy(false)
    }
  }

  const addsOf = (p: PluginInfo): string[] => (p.manifest ? describeAdds(p.manifest) : p.contributes)
  const cloudOf = (p: PluginInfo) => (p.manifest ? cloudDomains(p.manifest) : [])

  const previewAdds = preview ? preview.adds : []

  const cloudWarning = (cloud: PluginCloudProvider[]) =>
    cloud.length > 0 ? (
      <Alert severity="warning" variant="outlined" sx={{ mt: 1 }} icon={false}>
        Adds {cloud.length === 1 ? 'a cloud AI provider' : 'cloud AI providers'}:{' '}
        {cloud.map((c) => `${c.label} (${c.domain})`).join(', ')}. When used, your questions and note
        passages are sent to that service.
      </Alert>
    ) : null

  return (
    <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%', overflow: 'auto' }} data-testid="add-ons">
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <ExtensionIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
          Add-ons
        </Typography>
        <Button size="small" variant="contained" startIcon={<AddIcon />} disabled={busy} onClick={() => void pickAndPreview()}>
          Install add-on…
        </Button>
        <IconButton size="small" aria-label="Reload add-ons" disabled={busy} onClick={() => void refresh().catch((e) => setError(cleanErr(e)))}>
          <RefreshIcon fontSize="small" />
        </IconButton>
        {onClose && (
          <Button size="small" onClick={onClose}>
            Back to Ask
          </Button>
        )}
      </Stack>

      <Typography variant="body2" color="text.secondary">
        Add-ons add things to Vault: AI providers, voices for Media chat, quick-ask prompts and MCP
        connections. They can’t run code. <Link component="a" href={AUTHORS_DOC} target="_blank" rel="noreferrer">For plugin authors…</Link>
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {info && (
        <Alert severity="success" onClose={() => setInfo(null)}>
          {info}
        </Alert>
      )}

      {bundled.length > 0 && (
        <>
          <Typography variant="overline" color="text.secondary">
            Available add-ons
          </Typography>
          {bundled.map((b) => (
            <Paper key={b.id} variant="outlined" sx={{ p: 1.5, borderRadius: 3 }}>
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <Avatar variant="rounded" sx={{ width: 36, height: 36, bgcolor: 'primary.main' }}>
                  <ExtensionIcon fontSize="small" />
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {b.name}
                  </Typography>
                  {b.description && (
                    <Typography variant="body2" color="text.secondary">
                      {b.description}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                    {b.adds.map((a) => (
                      <Chip key={a} size="small" variant="outlined" label={a} />
                    ))}
                  </Stack>
                  {cloudWarning(b.cloudProviders)}
                </Box>
                <Button size="small" variant="contained" disabled={busy} onClick={() => setPreview(b)}>
                  Install
                </Button>
              </Stack>
            </Paper>
          ))}
        </>
      )}

      <Typography variant="overline" color="text.secondary">
        Installed
      </Typography>
      {data?.plugins.length ? (
        data.plugins.map((p) => (
          <Paper key={p.id} variant="outlined" sx={{ p: 1.5, borderRadius: 3 }} data-testid={`addon-row-${p.id}`}>
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
              <Avatar src={p.iconDataUrl} variant="rounded" sx={{ width: 36, height: 36, bgcolor: 'primary.main' }}>
                <ExtensionIcon fontSize="small" />
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="body2" fontWeight={600}>
                    {p.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    v{p.version}
                  </Typography>
                </Stack>
                {p.description && (
                  <Typography variant="body2" color="text.secondary">
                    {p.description}
                  </Typography>
                )}
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                  {addsOf(p).map((a) => (
                    <Chip key={a} size="small" variant="outlined" label={a} />
                  ))}
                </Stack>
                {cloudOf(p).length > 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    Cloud: {cloudOf(p).map((c) => c.domain).join(', ')}
                  </Typography>
                )}
              </Box>
              <Switch
                size="small"
                checked={p.enabled}
                disabled={busy}
                onChange={(e) =>
                  void window.lkv.plugins.setEnabled(p.id, e.target.checked).then(() => refresh())
                }
                inputProps={{ 'aria-label': `Enable ${p.name}` }}
              />
              <IconButton size="small" aria-label={`Remove ${p.name}`} disabled={busy} onClick={() => void doRemove(p)}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Paper>
        ))
      ) : (
        <Typography variant="body2" color="text.secondary">
          No add-ons installed yet. Pick one from “Available add-ons” above, or install a folder / .zip.
        </Typography>
      )}

      {data?.errors.map((e) => (
        <Alert key={e.dir} severity="warning" data-testid="plugin-load-error">
          <Typography variant="body2" fontWeight={600}>
            {e.folder}: not loaded
          </Typography>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {e.errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Alert>
      ))}

      {removed.length > 0 && (
        <>
          <Typography variant="overline" color="text.secondary">
            Removed
          </Typography>
          {removed.map((r) => (
            <Paper key={r.key} variant="outlined" sx={{ p: 1.5, borderRadius: 3 }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {r.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    v{r.version}
                  </Typography>
                </Box>
                <Button size="small" startIcon={<RestoreIcon />} disabled={busy} onClick={() => void doRestore(r.key)}>
                  Restore
                </Button>
              </Stack>
            </Paper>
          ))}
        </>
      )}

      <Dialog open={!!preview} onClose={() => setPreview(null)} fullWidth maxWidth="sm">
        {preview && (
          <>
            <DialogTitle>Install “{preview.name}”?</DialogTitle>
            <DialogContent dividers>
              {preview.description && (
                <Typography variant="body2" color="text.secondary" paragraph>
                  {preview.description}
                </Typography>
              )}
              <Typography variant="subtitle2">Adds:</Typography>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                {previewAdds.map((a) => (
                  <Chip key={a} size="small" variant="outlined" label={a} />
                ))}
              </Stack>
              {cloudWarning(preview.cloudProviders)}
            </DialogContent>
            <DialogActions>
              <Button disabled={installing} onClick={() => setPreview(null)}>
                Cancel
              </Button>
              <Button variant="contained" disabled={installing} onClick={() => void doInstall(preview)}>
                Install
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  )
}
