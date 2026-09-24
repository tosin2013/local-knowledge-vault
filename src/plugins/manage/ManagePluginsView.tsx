import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  IconButton,
  Link,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import ExtensionIcon from '@mui/icons-material/Extension'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import RefreshIcon from '@mui/icons-material/Refresh'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder'
import type { PluginInfo, PluginListResult } from '../../../electron/types'
import type { VaultPluginRenderProps } from '../types'
import { listPlugins } from '../registry'
import { notifyPluginsChanged } from '../contrib'

const cleanErr = (e: unknown) =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)

/** Manage built-in panels + installed declarative (plugin.json) plugins. */
export function ManagePluginsView({ onClose }: VaultPluginRenderProps) {
  const [data, setData] = useState<PluginListResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installErrors, setInstallErrors] = useState<string[] | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const apply = (r: PluginListResult) => {
    setData(r)
    notifyPluginsChanged()
  }

  const load = useCallback(async () => {
    try {
      setData(await window.lkv.plugins.list())
    } catch (e) {
      setError(cleanErr(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (fn: () => Promise<PluginListResult>) => {
    setBusy(true)
    setError(null)
    try {
      apply(await fn())
    } catch (e) {
      setError(cleanErr(e))
    } finally {
      setBusy(false)
    }
  }

  const install = async (kind: 'folder' | 'zip') => {
    setBusy(true)
    setError(null)
    setInstallErrors(null)
    setInfo(null)
    try {
      const r = await window.lkv.plugins.install(kind)
      if (r.canceled) return
      if (!r.ok) {
        setInstallErrors(r.errors ?? ['Install failed'])
      } else {
        setInfo(
          `Installed “${r.plugin?.name}” ${r.plugin?.version ?? ''}.` +
            (r.warnings?.length ? ` Notes: ${r.warnings.join(' ')}` : ''),
        )
      }
      apply(await window.lkv.plugins.list())
    } catch (e) {
      setError(cleanErr(e))
    } finally {
      setBusy(false)
    }
  }

  const disabled = new Set(data?.disabled ?? [])
  const builtins = listPlugins()

  const installedRow = (p: PluginInfo) => (
    <Paper key={p.id} variant="outlined" sx={{ p: 1.5, borderRadius: 3 }} data-testid={`plugin-row-${p.id}`}>
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
              {p.author ? ` · ${p.author}` : ''}
            </Typography>
            {p.contributes.map((c) => (
              <Chip key={c} size="small" variant="outlined" label={c} />
            ))}
          </Stack>
          {p.description && (
            <Typography variant="body2" color="text.secondary">
              {p.description}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
            {p.id}
          </Typography>
        </Box>
        <Switch
          size="small"
          checked={p.enabled}
          disabled={busy}
          onChange={(e) => void act(() => window.lkv.plugins.setEnabled(p.id, e.target.checked))}
          inputProps={{ 'aria-label': `Enable ${p.name}` }}
        />
        <IconButton
          size="small"
          aria-label={`Remove ${p.name}`}
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Remove “${p.name}”? It’s moved to plugins-removed/ so you can restore it.`)) {
              void act(() => window.lkv.plugins.remove(p.id))
            }
          }}
        >
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Paper>
  )

  return (
    <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%', overflow: 'auto' }} data-testid="manage-plugins">
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <ExtensionIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
          Manage plugins
        </Typography>
        <Button size="small" variant="contained" startIcon={<CreateNewFolderIcon />} disabled={busy} onClick={() => void install('folder')}>
          Install folder…
        </Button>
        <Button size="small" variant="outlined" startIcon={<UploadFileIcon />} disabled={busy} onClick={() => void install('zip')}>
          Install .zip…
        </Button>
        <Button size="small" startIcon={<FolderOpenIcon />} onClick={() => void window.lkv.plugins.openFolder()}>
          Open plugins folder
        </Button>
        <Button size="small" startIcon={<RefreshIcon />} disabled={busy} onClick={() => void act(() => window.lkv.plugins.reload())}>
          Reload
        </Button>
        {onClose && (
          <Button size="small" onClick={onClose}>
            Back to Ask
          </Button>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Plugins are small <code>plugin.json</code> packs — provider presets, personas, prompt packs and MCP server
        presets. They can’t run code. Drop a folder into the plugins folder and press Reload, or install a folder / .zip.
        See <code>docs/plugins-authoring.md</code>.
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
      {installErrors && (
        <Alert severity="error" onClose={() => setInstallErrors(null)}>
          <Typography variant="body2" fontWeight={600}>
            Plugin not installed:
          </Typography>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {installErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Typography variant="overline" color="text.secondary">
        Installed
      </Typography>
      {data?.plugins.length ? (
        data.plugins.map(installedRow)
      ) : (
        <Typography variant="body2" color="text.secondary">
          No plugins installed yet. Try the examples in <code>examples/plugins/</code>.
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

      <Typography variant="overline" color="text.secondary">
        Built-in panels
      </Typography>
      {builtins.map((b) => (
        <Paper key={b.id} variant="outlined" sx={{ p: 1.5, borderRadius: 3 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Typography variant="body2" fontWeight={600}>
                  {b.name}
                </Typography>
                <Chip size="small" variant="outlined" label="Built-in" />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {b.description}
              </Typography>
            </Box>
            <Switch
              size="small"
              checked={!disabled.has(b.id)}
              disabled={busy}
              onChange={(e) => void act(() => window.lkv.plugins.setEnabled(b.id, e.target.checked))}
              inputProps={{ 'aria-label': `Enable ${b.name}` }}
            />
          </Stack>
        </Paper>
      ))}
      {data?.pluginsDir && (
        <Typography variant="caption" color="text.secondary">
          Plugins folder:{' '}
          <Link component="button" type="button" onClick={() => void window.lkv.plugins.openFolder()}>
            {data.pluginsDir}
          </Link>
        </Typography>
      )}
    </Box>
  )
}
