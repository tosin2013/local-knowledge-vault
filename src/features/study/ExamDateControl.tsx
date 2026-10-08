import { useEffect, useState } from 'react'
import { Button, Chip, Stack, TextField, Typography } from '@mui/material'
import EventIcon from '@mui/icons-material/Event'
import { daysToExam, daysToGoLabel, formatExamDate } from './examDate'

export interface ExamDateControlProps {
  /** The Study project ('' = all projects, which has no exam date). */
  project: string
  /** Called after the date is saved or cleared. */
  onChange?: (examDate: string | null) => void
}

/**
 * Shows the selected project's saved exam date (#261) with an Edit control, so
 * the date can be set from Study as well as from Manage projects. "All
 * projects" has no exam date: spacing there is plain, with no exam anchor.
 */
export function ExamDateControl({ project, onChange }: ExamDateControlProps) {
  const [examDate, setExamDate] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    setEditing(false)
    setError(null)
    setExamDate(null)
    const get = window.lkv?.projects?.getSettings
    if (!project || !get) return
    get(project)
      .then((s) => {
        if (alive) setExamDate(s?.examDate ?? null)
      })
      .catch(() => {
        /* no settings yet */
      })
    return () => {
      alive = false
    }
  }, [project])

  if (!project) {
    return (
      <Typography variant="caption" color="text.secondary" data-testid="exam-date-none">
        Pick a project to set its exam date. All projects use plain spacing with no exam date.
      </Typography>
    )
  }

  const save = async (value: string | null) => {
    const set = window.lkv?.projects?.setExamDate
    if (!set) return
    setBusy(true)
    setError(null)
    try {
      const res = await set(project, value)
      setExamDate(res?.examDate ?? null)
      setEditing(false)
      onChange?.(res?.examDate ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <TextField
          size="small"
          type="date"
          label="Exam date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          InputLabelProps={{ shrink: true }}
          inputProps={{ 'aria-label': 'Exam date' }}
          error={!!error}
          helperText={error ?? undefined}
          sx={{ width: 190 }}
        />
        <Button size="small" variant="contained" disabled={busy || !draft} onClick={() => void save(draft)}>
          Save
        </Button>
        {examDate && (
          <Button size="small" color="inherit" disabled={busy} onClick={() => void save(null)}>
            Clear
          </Button>
        )}
        <Button size="small" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </Stack>
    )
  }

  const days = daysToExam(examDate)
  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap data-testid="exam-date">
      <EventIcon fontSize="small" color={examDate ? 'primary' : 'disabled'} />
      {examDate ? (
        <>
          <Typography variant="body2">
            Exam <strong>{formatExamDate(examDate)}</strong>
          </Typography>
          <Chip size="small" color={days != null && days < 0 ? 'default' : 'primary'} variant="outlined" label={daysToGoLabel(days)} />
        </>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No exam date for {project}
        </Typography>
      )}
      <Button
        size="small"
        onClick={() => {
          setDraft(examDate ?? '')
          setEditing(true)
        }}
      >
        {examDate ? 'Edit' : 'Set exam date'}
      </Button>
    </Stack>
  )
}
