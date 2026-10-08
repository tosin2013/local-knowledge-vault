import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  Link,
  ListSubheader,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import type {
  ProviderConfig,
  ProviderDraft,
  ProviderKind,
  ProviderPresetInfo,
  ProviderTestResult,
} from '../../../electron/types'

const CUSTOM: ProviderPresetInfo = {
  id: 'custom',
  kind: 'openai-compatible',
  label: 'Custom (OpenAI-compatible)',
  baseUrl: 'http://127.0.0.1:8000/v1',
  defaultModel: '',
  local: false,
  requiresKey: false,
  supportsModelList: true,
  notes: 'Any server that speaks the OpenAI /chat/completions API (vLLM, llama.cpp server, LocalAI, Jan, a gateway…).',
}

function isLocalUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.local')
  } catch {
    return false
  }
}

/**
 * Add / edit a provider. The API key is write-only: typed here, sent to the main process,
 * stored locally (0600) and never read back into the UI.
 */
export function ProviderDialog({
  open,
  presets,
  editing,
  initialPresetId,
  keyStorage,
  onClose,
  onSaved,
}: {
  open: boolean
  presets: ProviderPresetInfo[]
  editing: ProviderConfig | null
  /** Preselect a preset when adding (e.g. first-run "Use a cloud model instead"). */
  initialPresetId?: string
  /** How saved keys are stored on this computer (#237). */
  keyStorage?: 'encrypted' | 'plaintext'
  onClose: () => void
  onSaved: (cfg: ProviderConfig) => void
}) {
  const allPresets = useMemo(() => {
    const list = presets.filter((p) => p.id !== 'custom')
    return [...list, presets.find((p) => p.id === 'custom') ?? CUSTOM]
  }, [presets])

  const [presetId, setPresetId] = useState('custom')
  const [kind, setKind] = useState<ProviderKind>('openai-compatible')
  const [label, setLabel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [clearKey, setClearKey] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [modelsMsg, setModelsMsg] = useState<string | null>(null)
  const [test, setTest] = useState<ProviderTestResult | null>(null)
  const [busy, setBusy] = useState<'test' | 'models' | 'save' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const preset = allPresets.find((p) => p.id === presetId) ?? CUSTOM
  const isBuiltinLocal = editing?.id === 'ollama' || editing?.id === 'lmstudio'
  const local = editing?.local ?? (preset.local || isLocalUrl(baseUrl))
  const keyOptional = editing ? !editing.requiresKey : !preset.requiresKey

  const applyPreset = (p: ProviderPresetInfo) => {
    setPresetId(p.id)
    setKind(p.kind)
    setLabel(p.id === 'custom' ? '' : p.label.replace(/\s*\(.*\)$/, ''))
    setBaseUrl(p.baseUrl)
    setModel(p.defaultModel)
    setModels([])
    setModelsMsg(null)
    setTest(null)
    setErr(null)
  }

  useEffect(() => {
    if (!open) return
    setApiKey('')
    setShowKey(false)
    setClearKey(false)
    setModels([])
    setModelsMsg(null)
    setTest(null)
    setErr(null)
    setBusy(null)
    if (editing) {
      setPresetId(editing.presetId ?? 'custom')
      setKind(editing.kind)
      setLabel(editing.label)
      setBaseUrl(editing.baseUrl)
      setModel(editing.model)
      if (editing.health?.models?.length) setModels(editing.health.models)
    } else {
      const p =
        allPresets.find((x) => x.id === initialPresetId) ??
        allPresets.find((x) => x.id === 'openrouter') ??
        allPresets[0]
      applyPreset(p)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, initialPresetId])

  // Plugin presets already exist as (disabled) plugin providers: adding one = configure + enable it.
  const draft = (): ProviderDraft => ({
    id: editing?.id ?? (preset.pluginId ? preset.id : undefined),
    ...(!editing && preset.pluginId ? { enabled: true } : {}),
    presetId: editing ? editing.presetId : presetId,
    kind,
    label: label.trim() || preset.label,
    baseUrl: baseUrl.trim(),
    model: model.trim(),
    local,
    apiKey: apiKey.trim() ? apiKey.trim() : clearKey ? null : undefined,
  })

  const onFetchModels = async () => {
    setBusy('models')
    setModelsMsg(null)
    try {
      const r = await window.lkv.providers.fetchModels(draft())
      if (r.ok) {
        setModels(r.models)
        setModelsMsg(r.models.length ? `${r.models.length} models available` : 'Connected, but no models listed')
      } else {
        setModelsMsg(r.error ?? 'Could not list models')
      }
    } finally {
      setBusy(null)
    }
  }

  const onTest = async () => {
    setBusy('test')
    setTest(null)
    try {
      setTest(await window.lkv.providers.test(draft()))
    } finally {
      setBusy(null)
    }
  }

  const onSave = async () => {
    setBusy('save')
    setErr(null)
    try {
      const saved = await window.lkv.providers.save(draft())
      onSaved(saved)
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setBusy(null)
    }
  }

  const localPresets = allPresets.filter((p) => p.local && p.id !== 'custom' && !p.pluginId)
  const cloudPresets = allPresets.filter((p) => !p.local && p.id !== 'custom' && !p.pluginId)
  const pluginPresets = allPresets.filter((p) => !!p.pluginId)
  const keySaved = !!editing?.hasKey && !clearKey

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" data-testid="provider-dialog">
      <DialogTitle>{editing ? `Edit ${editing.label}` : 'Add provider'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {!editing && (
            <FormControl size="small" fullWidth>
              <InputLabel id="provider-preset-label">Preset</InputLabel>
              <Select
                labelId="provider-preset-label"
                label="Preset"
                value={presetId}
                onChange={(e) => {
                  const p = allPresets.find((x) => x.id === e.target.value)
                  if (p) applyPreset(p)
                }}
              >
                <ListSubheader>Local (private)</ListSubheader>
                {localPresets.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.label}
                  </MenuItem>
                ))}
                <ListSubheader>Cloud</ListSubheader>
                {cloudPresets.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.label}
                  </MenuItem>
                ))}
                {pluginPresets.length > 0 && <ListSubheader>From plugins</ListSubheader>}
                {pluginPresets.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.label}
                  </MenuItem>
                ))}
                <ListSubheader>Other</ListSubheader>
                <MenuItem value="custom">Custom (OpenAI-compatible)</MenuItem>
              </Select>
            </FormControl>
          )}
          {!editing && (preset.notes || preset.keyUrl) && (
            <Typography variant="caption" color="text.secondary">
              {preset.notes}{' '}
              {preset.keyUrl && (
                <Link component="button" type="button" onClick={() => void window.lkv.app.openExternal(preset.keyUrl!)}>
                  Get an API key
                </Link>
              )}
            </Typography>
          )}
          {!editing && presetId === 'custom' && (
            <FormControl size="small" fullWidth>
              <InputLabel id="provider-kind-label">API style</InputLabel>
              <Select
                labelId="provider-kind-label"
                label="API style"
                value={kind}
                onChange={(e) => setKind(e.target.value as ProviderKind)}
              >
                <MenuItem value="openai-compatible">OpenAI-compatible (/chat/completions)</MenuItem>
                <MenuItem value="anthropic">Anthropic Messages API</MenuItem>
                <MenuItem value="ollama">Ollama API</MenuItem>
              </Select>
            </FormControl>
          )}
          <TextField size="small" label="Name" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={preset.label} />
          <TextField
            size="small"
            label="Base URL"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            helperText={local ? 'Local server — requests stay on this computer.' : 'Cloud — your question and the matching note passages are sent to this provider.'}
          />
          {!isBuiltinLocal && (
            <TextField
              size="small"
              label={keyOptional ? 'API key (optional)' : 'API key'}
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value)
                if (e.target.value) setClearKey(false)
              }}
              placeholder={keySaved ? '•••••••• saved — leave blank to keep' : 'Paste key'}
              helperText={
                editing?.keySource === 'env'
                  ? 'Using a key from an environment variable.'
                  : keyStorage === 'plaintext'
                    ? 'Stored only on this computer in an owner-only file. Not encrypted: this computer has no keychain Vault can use. Never shown again.'
                    : keyStorage === 'encrypted'
                      ? 'Stored only on this computer, encrypted with your system keychain. Never shown again.'
                      : 'Stored only on this computer (owner-only file). Never shown again.'
              }
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" aria-label={showKey ? 'Hide key' : 'Show key'} onClick={() => setShowKey((v) => !v)}>
                      {showKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          )}
          {editing?.hasKey && editing.keySource === 'file' && !apiKey && (
            <Button size="small" color="warning" sx={{ alignSelf: 'flex-start' }} onClick={() => setClearKey((v) => !v)}>
              {clearKey ? 'Keep saved key' : 'Remove saved key on save'}
            </Button>
          )}
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <Autocomplete
              freeSolo
              fullWidth
              size="small"
              options={models}
              value={model}
              inputValue={model}
              onInputChange={(_e, v) => setModel(v)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Model"
                  placeholder={local ? 'Leave blank to auto-pick an installed model' : preset.defaultModel || 'model id'}
                  helperText={modelsMsg ?? (local && !model ? 'Blank = auto-pick the best installed model' : ' ')}
                />
              )}
            />
            <Button variant="outlined" onClick={() => void onFetchModels()} disabled={busy !== null || !baseUrl.trim()} sx={{ whiteSpace: 'nowrap', mt: 0.1 }}>
              {busy === 'models' ? 'Fetching…' : 'Fetch models'}
            </Button>
          </Stack>
          {test && (
            <Alert severity={test.ok ? 'success' : 'error'} data-testid="provider-test-result">
              {test.ok
                ? `Connected · ${test.latencyMs} ms · ${test.model ?? ''}${test.sample ? ` · replied “${test.sample.trim()}”` : ''}`
                : `Failed after ${test.latencyMs} ms: ${test.error ?? 'unknown error'}`}
            </Alert>
          )}
          {err && <Alert severity="error">{err}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={() => void onTest()} disabled={busy !== null || !baseUrl.trim()}>
          {busy === 'test' ? 'Testing…' : 'Test connection'}
        </Button>
        <span style={{ flex: 1 }} />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => void onSave()} disabled={busy !== null || !baseUrl.trim()}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
