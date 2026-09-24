import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RefreshIcon from '@mui/icons-material/Refresh'
import type { LlmStatus, ProviderConfig } from '../../../electron/types'

function healthChip(p: ProviderConfig, activeId: string | undefined) {
  if (p.id === activeId) return <Chip size="small" color="success" label="In use" />
  if (!p.enabled) return <Chip size="small" variant="outlined" label="Off" />
  if (p.requiresKey && !p.hasKey) return <Chip size="small" color="warning" variant="outlined" label="Needs key" />
  if (p.local) {
    if (p.health?.ok) {
      const n = p.health.models?.length ?? 0
      return (
        <Chip
          size="small"
          color={n ? 'success' : 'warning'}
          variant="outlined"
          label={n ? `Running · ${n} model${n === 1 ? '' : 's'}` : 'Running · no models'}
        />
      )
    }
    return <Chip size="small" variant="outlined" label="Not running" title={p.health?.error} />
  }
  return <Chip size="small" variant="outlined" color="primary" label="Ready" />
}

/**
 * Advanced-mode provider registry: local first, enable switches, selection, per-provider model.
 */
export function ProvidersPanel({
  status,
  checking,
  onRefresh,
  onAdd,
  onEdit,
  onError,
}: {
  status: LlmStatus
  checking: boolean
  onRefresh: () => void
  onAdd: () => void
  onEdit: (p: ProviderConfig) => void
  onError: (msg: string) => void
}) {
  const providers = status.providers
  const activeId = status.active?.id
  const locals = providers.filter((p) => p.local)
  const clouds = providers.filter((p) => !p.local)

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      onError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      onRefresh()
    }
  }

  const setModel = (p: ProviderConfig, model: string) =>
    run(() =>
      window.lkv.providers.save({ id: p.id, kind: p.kind, label: p.label, baseUrl: p.baseUrl, model, local: p.local }),
    )

  const row = (p: ProviderConfig) => {
    const installed = p.health?.models ?? []
    const sizes = p.health?.modelSizes ?? {}
    const canRemove = p.source === 'user' || (p.source === 'builtin' && p.id !== 'ollama' && p.id !== 'lmstudio')
    return (
      <Paper key={p.id} variant="outlined" sx={{ p: 1.25, borderRadius: 3 }} data-testid={`provider-row-${p.id}`}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Switch
            size="small"
            checked={p.enabled}
            onChange={(e) => void run(() => window.lkv.providers.setEnabled(p.id, e.target.checked))}
            inputProps={{ 'aria-label': `Enable ${p.label}` }}
          />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="body2" fontWeight={600}>
                {p.label}
              </Typography>
              <Chip size="small" variant="outlined" label={p.local ? 'Local' : 'Cloud'} color={p.local ? 'secondary' : 'default'} />
              {p.source === 'plugin' && <Chip size="small" variant="outlined" label="Plugin" />}
              {healthChip(p, activeId)}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.baseUrl}
              {!p.local && (p.hasKey ? ` · key ${p.keySource === 'env' ? 'from env' : 'saved'}` : ' · no key')}
              {!p.local || !installed.length ? (p.model ? ` · ${p.model}` : p.local ? ' · auto-pick model' : '') : ''}
            </Typography>
          </Box>
          {p.local && installed.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 190 }}>
              <InputLabel id={`model-${p.id}`}>Model</InputLabel>
              <Select
                labelId={`model-${p.id}`}
                label="Model"
                value={installed.includes(p.model) ? p.model : ''}
                onChange={(e) => void setModel(p, String(e.target.value))}
                displayEmpty
                renderValue={(v) => (v ? String(v) : 'Auto-pick')}
              >
                <MenuItem value="">Auto-pick (best installed)</MenuItem>
                {installed.map((m) => (
                  <MenuItem key={m} value={m}>
                    {m}
                    {sizes[m] ? ` · ${sizes[m]}` : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <IconButton size="small" aria-label={`Edit ${p.label}`} onClick={() => onEdit(p)}>
            <EditOutlinedIcon fontSize="small" />
          </IconButton>
          {canRemove && (
            <IconButton
              size="small"
              aria-label={`Remove ${p.label}`}
              onClick={() => {
                if (window.confirm(`Remove ${p.label}? Its saved key file is deleted too (legacy Groq/xAI key files are kept).`)) {
                  void run(() => window.lkv.providers.remove(p.id))
                }
              }}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
      </Paper>
    )
  }

  return (
    <Stack spacing={1.25} sx={{ maxWidth: 760 }} data-testid="providers-panel">
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <FormControl size="small" sx={{ minWidth: 260 }}>
          <InputLabel id="provider-selection-label">Use</InputLabel>
          <Select
            labelId="provider-selection-label"
            label="Use"
            value={providers.some((p) => p.id === status.selected) ? status.selected : 'auto'}
            onChange={(e) => void run(() => window.lkv.providers.setSelected(String(e.target.value)))}
          >
            <MenuItem value="auto">Auto (local first, then enabled cloud)</MenuItem>
            {providers
              .filter((p) => p.enabled)
              .map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.label} only{p.local ? ' (local)' : ''}
                </MenuItem>
              ))}
          </Select>
        </FormControl>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={onAdd}>
          Add provider
        </Button>
        <Button size="small" startIcon={<RefreshIcon />} onClick={onRefresh} disabled={checking}>
          {checking ? 'Checking…' : 'Re-check'}
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 200 }}>
          {status.message}
        </Typography>
      </Stack>
      {status.selected !== 'auto' && (
        <Alert severity="info" variant="outlined" sx={{ py: 0 }}>
          Fixed to one provider: Vault won’t fall back to a local model if it fails. Pick “Auto” for local-first.
        </Alert>
      )}
      <Typography variant="overline" color="text.secondary">
        Local — nothing leaves this computer
      </Typography>
      {locals.map(row)}
      <Typography variant="overline" color="text.secondary">
        Cloud — used only when enabled
      </Typography>
      {clouds.length ? clouds.map(row) : (
        <Typography variant="body2" color="text.secondary">
          No cloud providers. Add one if you don’t run a local model.
        </Typography>
      )}
    </Stack>
  )
}
