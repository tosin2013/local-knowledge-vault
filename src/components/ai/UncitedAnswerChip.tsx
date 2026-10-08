import { Chip, Tooltip } from '@mui/material'
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined'

/**
 * Per-answer warning when an answer had substance but cited none of the
 * retrieved notes (#235). Metadata only: the label is never stored in the
 * message text, so it cannot leak into history, exports or saved notes.
 */
export function UncitedAnswerChip({ uncited }: { uncited?: boolean }) {
  if (!uncited) return null
  const title =
    'This answer cites none of your notes. Check it before relying on it — it may not be grounded in your vault.'
  return (
    <Tooltip title={title}>
      <Chip
        size="small"
        variant="outlined"
        color="warning"
        icon={<WarningAmberOutlinedIcon />}
        label="No notes cited"
        aria-label={title}
        data-testid="uncited-answer-chip"
        sx={{ mt: 1, mr: 1 }}
      />
    </Tooltip>
  )
}