import { useMemo, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  Collapse,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter'
import type { ProjectReadiness, ReadinessNote } from '../../../electron/types'
import {
  READINESS_CAPTION,
  daysToExamPhrase,
  dueBeforeLabel,
  readinessSummary,
  trendLabel,
  workOnWeakSpotsLabel,
} from './readinessCopy'

export interface ReadinessPanelProps {
  readiness: ProjectReadiness | null
  /** True while the weak-spots session is being prepared. */
  starting?: boolean
  onOpenNote?: (id: string) => void
  onWorkWeakSpots?: () => void
}

const GROUP_META: Array<{
  key: 'strong' | 'shaky' | 'unstudied'
  label: string
  color: 'success' | 'warning' | 'default'
}> = [
  { key: 'strong', label: 'Strong', color: 'success' },
  { key: 'shaky', label: 'Shaky', color: 'warning' },
  { key: 'unstudied', label: 'Not studied', color: 'default' },
]

function NoteList({
  notes,
  label,
  onOpenNote,
}: {
  notes: ReadinessNote[]
  label: string
  onOpenNote?: (id: string) => void
}) {
  if (notes.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary', px: 0.5 }}>
        None
      </Typography>
    )
  }
  return (
    <List dense disablePadding aria-label={label}>
      {notes.map((n) => (
        <ListItemButton
          key={n.itemId}
          disableGutters
          onClick={onOpenNote ? () => onOpenNote(n.itemId) : undefined}
          aria-label={`Open ${n.title}`}
          sx={{ px: 0.5, alignItems: 'flex-start' }}
        >
          <ListItemText primary={n.title} secondary={n.reasons.join(' · ')} />
        </ListItemButton>
      ))}
    </List>
  )
}

/**
 * Per-project exam readiness (#420): Strong / Shaky / Not studied, with
 * evidence for each note and a button to start a session on the weak spots.
 * Never says "you're ready."
 */
export function ReadinessPanel({ readiness, starting, onOpenNote, onWorkWeakSpots }: ReadinessPanelProps) {
  const [open, setOpen] = useState(true)
  const weak = readiness?.weakItemIds.length ?? 0
  const due = readiness ? dueBeforeLabel(readiness) : null
  const trend = readiness ? trendLabel(readiness.trend) : null
  const groups = useMemo(
    () =>
      readiness
        ? GROUP_META.map((g) => ({ ...g, notes: readiness[g.key] }))
        : [],
    [readiness],
  )

  if (!readiness) return null

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-testid="readiness-panel">
      <Stack spacing={1}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Typography
            variant="subtitle2"
            sx={{
              fontWeight: 600,
              flex: '1 1 auto',
            }}
          >
            Readiness
          </Typography>
          {GROUP_META.map((g) => (
            <Chip
              key={g.key}
              size="small"
              color={g.color}
              variant={g.color === 'default' ? 'outlined' : 'filled'}
              label={`${g.label}: ${readiness[g.key].length}`}
            />
          ))}
          {daysToExamPhrase(readiness.daysToExam) && (
            <Chip size="small" variant="outlined" label={daysToExamPhrase(readiness.daysToExam) ?? ''} />
          )}
        </Stack>
        <Typography variant="body2" data-testid="readiness-summary">
          {readinessSummary(readiness)}
        </Typography>
        {due && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }} data-testid="readiness-due">
            {due}
          </Typography>
        )}
        {trend && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }} data-testid="readiness-trend">
            {trend}
          </Typography>
        )}
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {READINESS_CAPTION}
        </Typography>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Button
            variant="contained"
            color="warning"
            startIcon={<FitnessCenterIcon />}
            disabled={weak === 0 || starting || !onWorkWeakSpots}
            onClick={onWorkWeakSpots}
            data-testid="work-weak-spots"
          >
            {starting ? 'Starting…' : workOnWeakSpotsLabel(weak)}
          </Button>
          <Button size="small" onClick={() => setOpen((v) => !v)} sx={{ px: 0 }}>
            {open ? 'Hide notes' : 'Show notes'}
          </Button>
        </Stack>
        <Collapse in={open}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            useFlexGap
            sx={{
              alignItems: 'flex-start',
            }}
          >
            {groups.map((g) => (
              <Box key={g.key} sx={{ flex: '1 1 160px', minWidth: 160 }} data-testid={`readiness-${g.key}`}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                  {g.label}
                </Typography>
                <NoteList notes={g.notes} label={g.label} onOpenNote={onOpenNote} />
              </Box>
            ))}
          </Stack>
        </Collapse>
      </Stack>
    </Paper>
  )
}
