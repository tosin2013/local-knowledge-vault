import { Button, Dialog, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import type { LlmStatus, ProviderConfig } from '../../electron/types'
import { FirstRunLocalCard, SmallModelHint } from '../components/ai/FirstRunLocalCard'
import { ProvidersPanel } from '../components/ai/ProvidersPanel'
import { BridgeSettings } from '../components/ai/BridgeSettings'
import { UpdateSettings } from '../components/updates/UpdateSettings'

export interface AiSettingsDialogProps {
  open: boolean
  advanced: boolean
  llmStatus: LlmStatus | null
  llmChecking: boolean
  onClose: () => void
  onRefresh: () => void
  onAddProvider: (presetId?: string) => void
  onEditProvider: (p: ProviderConfig) => void
  onError: (m: string) => void
  onUseAdvanced: () => void
}

export function AiSettingsDialog(props: AiSettingsDialogProps) {
  const {
    open,
    advanced,
    llmStatus,
    llmChecking,
    onClose,
    onRefresh,
    onAddProvider,
    onEditProvider,
    onError,
    onUseAdvanced,
  } = props

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth={advanced ? 'md' : 'sm'}>
      <DialogTitle>AI providers</DialogTitle>
      <DialogContent>
        {llmStatus && advanced && (
          <ProvidersPanel
            status={llmStatus}
            checking={llmChecking}
            onRefresh={onRefresh}
            onAdd={onAddProvider}
            onEdit={onEditProvider}
            onError={onError}
          />
        )}
        {llmStatus && !advanced && (
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <Typography variant="body2">{llmStatus.message}</Typography>
            {llmStatus.needsSetup && (
              <FirstRunLocalCard
                status={llmStatus}
                checking={llmChecking}
                onRecheck={onRefresh}
                onUseCloud={() => onAddProvider('openrouter')}
              />
            )}
            {llmStatus.active?.smallModel && (
              <SmallModelHint active={llmStatus.active} recommended={llmStatus.recommendedLocalModel?.name} onDismiss={() => undefined} />
            )}
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={onRefresh} disabled={llmChecking}>
                {llmChecking ? 'Checking…' : 'Re-check'}
              </Button>
              <Button size="small" onClick={() => onAddProvider()}>
                Add provider
              </Button>
              <Button size="small" onClick={onUseAdvanced}>
                All providers (Advanced)
              </Button>
            </Stack>
          </Stack>
        )}
        <BridgeSettings />
        <UpdateSettings />
      </DialogContent>
    </Dialog>
  )
}
