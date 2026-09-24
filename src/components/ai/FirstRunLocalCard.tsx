import { useState } from 'react'
import { Alert, Box, Button, Chip, IconButton, Link, Paper, Stack, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CloseIcon from '@mui/icons-material/Close'
import type { ActiveProviderInfo, LlmStatus } from '../../../electron/types'

const FALLBACK_REC = {
  name: 'qwen3:8b',
  command: 'ollama pull qwen3:8b',
  why: 'Small enough for most laptops (~5 GB) and strong at following citation rules.',
}

function openExternal(url: string) {
  void window.lkv?.app?.openExternal(url)
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{
        px: 1.5,
        py: 0.75,
        borderRadius: 2,
        bgcolor: 'action.hover',
        border: 1,
        borderColor: 'divider',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      <Typography component="code" variant="body2" sx={{ fontFamily: 'inherit', flex: 1, userSelect: 'all' }}>
        {command}
      </Typography>
      <IconButton
        size="small"
        aria-label="Copy command"
        title={copied ? 'Copied' : 'Copy'}
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        <ContentCopyIcon fontSize="small" />
      </IconButton>
      {copied && <Chip size="small" label="Copied" color="success" variant="outlined" />}
    </Stack>
  )
}

/**
 * First-run card: shown when no local model is detected and no cloud provider is enabled.
 * Local-first: Ollama / LM Studio are the primary path; cloud is the clearly visible second choice.
 */
export function FirstRunLocalCard({
  status,
  checking,
  onRecheck,
  onUseCloud,
}: {
  status: LlmStatus
  checking: boolean
  onRecheck: () => void
  onUseCloud: () => void
}) {
  const rec = status.recommendedLocalModel ?? FALLBACK_REC
  const ollama = status.providers.find((p) => p.id === 'ollama')
  const ollamaRunningNoModels = !!ollama?.health?.ok && (ollama.health.models?.length ?? 0) === 0
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2.5, borderRadius: 4, maxWidth: 560, width: '100%', alignSelf: 'center', bgcolor: 'background.paper' }}
      data-testid="first-run-local-card"
    >
      <Typography variant="h6" color="primary" gutterBottom>
        Vault runs on local models
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {ollamaRunningNoModels
          ? 'Ollama is running but has no models yet. Pull one and we’ll pick it up automatically.'
          : 'Start Ollama or LM Studio and we’ll detect it — your notes never leave this computer. Search works either way.'}
      </Typography>

      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        Recommended model: <b>{rec.name}</b>
      </Typography>
      <CopyCommand command={rec.command} />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, mb: 1.5 }}>
        {rec.why} Using LM Studio instead? Search for “Qwen3 8B” in its model browser and load it.
      </Typography>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
        <Button variant="contained" onClick={onRecheck} disabled={checking}>
          {checking ? 'Checking…' : 'Re-check'}
        </Button>
        <Button variant="outlined" onClick={onUseCloud}>
          Use a cloud model instead
        </Button>
        <Box sx={{ flex: 1 }} />
        <Link component="button" type="button" variant="body2" onClick={() => openExternal('https://ollama.com/download')}>
          Get Ollama
        </Link>
        <Link component="button" type="button" variant="body2" onClick={() => openExternal('https://lmstudio.ai')}>
          Get LM Studio
        </Link>
      </Stack>
    </Paper>
  )
}

/** Gentle nudge when the detected local model looks tiny (<3B params). */
export function SmallModelHint({
  active,
  recommended,
  onDismiss,
}: {
  active: ActiveProviderInfo
  recommended?: string
  onDismiss: () => void
}) {
  const rec = recommended ?? FALLBACK_REC.name
  return (
    <Alert
      severity="info"
      variant="outlined"
      sx={{ borderRadius: 3 }}
      action={
        <IconButton size="small" aria-label="Dismiss hint" onClick={onDismiss}>
          <CloseIcon fontSize="small" />
        </IconButton>
      }
    >
      Using <b>{active.model}</b>, a small model. Bigger models (for example <code>{rec}</code>) follow the citation
      rules more reliably: <code>ollama pull {rec}</code>
    </Alert>
  )
}

/** Header chip label: "Local · Ollama · qwen3:8b" / "Cloud · Groq · openai/gpt-oss-20b". */
export function aiChipLabel(status: LlmStatus | null, advanced: boolean): string {
  if (!status) return 'AI: …'
  const a = status.active
  if (a) {
    const where = a.local ? 'Local' : 'Cloud'
    return a.model ? `${where} · ${a.label} · ${a.model}` : `${where} · ${a.label}`
  }
  if (status.needsSetup) return advanced ? 'AI: no local model detected' : 'AI: set up local model'
  return advanced ? status.message : 'AI: not available — search still works'
}
