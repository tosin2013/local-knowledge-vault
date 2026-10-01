import { Chip, Tooltip } from '@mui/material'
import CloudOutlinedIcon from '@mui/icons-material/CloudOutlined'
import { parseAnswerProvider } from '../../domain'

/**
 * Per-answer badge for answers written by a cloud provider (#45). Local answers
 * show nothing, so the badge only appears when something left this computer.
 */
export function AnswerProviderChip({ providerJson }: { providerJson: string | null | undefined }) {
  const p = parseAnswerProvider(providerJson)
  if (!p || p.local) return null
  const sent = 'Your question and the matching note passages were sent to it.'
  const title = p.fallback
    ? `No local model answered, so Auto used ${p.label} (${p.model}). ${sent} To prevent this, choose “Auto — local only” in AI settings.`
    : `Answered by ${p.label} (${p.model}). ${sent}`
  return (
    <Tooltip title={title}>
      <Chip
        size="small"
        variant="outlined"
        color={p.fallback ? 'warning' : 'info'}
        icon={<CloudOutlinedIcon />}
        label={p.fallback ? `Cloud fallback · ${p.label}` : `Cloud · ${p.label}`}
        aria-label={title}
        data-testid="answer-provider-chip"
        sx={{ mt: 1, mr: 1 }}
      />
    </Tooltip>
  )
}
