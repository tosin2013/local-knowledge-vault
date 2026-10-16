import { Alert, List, ListItemButton, ListItemText, Typography } from '@mui/material'
import type { RepeatedPick } from '../../../electron/types'

export interface RepeatedPicksProps {
  picks: RepeatedPick[] | undefined
  onOpenNote?: (id: string) => void
}

/**
 * "Answers you keep picking" (#324): wrong multiple-choice answers picked more
 * than once on the same card, each linked to the practice test it came from.
 */
export function RepeatedPicks({ picks, onOpenNote }: RepeatedPicksProps) {
  if (!picks || picks.length === 0) return null
  return (
    <Alert severity="warning" icon={false} data-testid="repeated-picks">
      <Typography variant="body2" fontWeight={600}>
        Answers you keep picking ({picks.length})
      </Typography>
      <Typography variant="caption" sx={{ display: 'block', mb: 0.5 }}>
        Wrong answers you chose more than once. Notice why they tempt you; these cards come back first.
      </Typography>
      <List dense disablePadding>
        {picks.map((p) => (
          <ListItemButton
            key={`${p.cardId}-${p.picked}`}
            disableGutters
            onClick={onOpenNote ? () => onOpenNote(p.itemId) : undefined}
            aria-label={`Open the test for: ${p.question}`}
          >
            <ListItemText
              primary={`“${p.picked}” ×${p.times}, the answer is “${p.answer}”`}
              secondary={p.question}
            />
          </ListItemButton>
        ))}
      </List>
    </Alert>
  )
}
