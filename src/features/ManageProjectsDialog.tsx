import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { ProjectSummary } from '../../electron/types'
import { daysToExam, daysToGoLabel, formatExamDate } from './study/examDate'

export interface ManageProjectsDialogProps {
  open: boolean
  projects: ProjectSummary[]
  busy: boolean
  onClose: () => void
  onRename: (from: string, to: string) => void
  onMerge: (from: string, into: string) => void
  onDelete: (name: string) => void
  /** Set or clear (null) a project's exam date (#261). */
  onSetExamDate?: (name: string, examDate: string | null) => void
}

function projectSecondary(p: ProjectSummary): string {
  const notes = `${p.count} note${p.count === 1 ? '' : 's'}`
  if (!p.examDate) return notes
  return `${notes} · Exam ${formatExamDate(p.examDate)} (${daysToGoLabel(daysToExam(p.examDate)).toLowerCase()})`
}

/** Rename / merge / delete the first-class projects (each derived from note count). */
export function ManageProjectsDialog(props: ManageProjectsDialogProps) {
  const { open, projects, busy, onClose, onRename, onMerge, onDelete, onSetExamDate } = props

  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [merging, setMerging] = useState<string | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')
  const [dating, setDating] = useState<string | null>(null)
  const [dateValue, setDateValue] = useState('')

  const reset = () => {
    setRenaming(null)
    setRenameValue('')
    setMerging(null)
    setMergeTarget('')
    setDating(null)
    setDateValue('')
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Manage projects</DialogTitle>
      <DialogContent dividers>
        {projects.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No projects yet. Assign a project to a note (its Project picker) to create one.
          </Typography>
        ) : (
          <List dense disablePadding>
            {projects.map((p) => {
              const isRenaming = renaming === p.name
              const isMerging = merging === p.name
              const isDating = dating === p.name
              return (
                <ListItem
                  key={p.name}
                  disableGutters
                  sx={{ flexDirection: 'column', alignItems: 'stretch', py: 1 }}
                >
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <ListItemText primary={p.name} secondary={projectSecondary(p)} />
                    {!isRenaming && !isMerging && !isDating && (
                      <Stack direction="row" spacing={0.5}>
                        {onSetExamDate && (
                          <Button
                            size="small"
                            onClick={() => {
                              reset()
                              setDating(p.name)
                              setDateValue(p.examDate ?? '')
                            }}
                          >
                            Exam date
                          </Button>
                        )}
                        <Button size="small" onClick={() => { setRenaming(p.name); setRenameValue(p.name) }}>
                          Rename
                        </Button>
                        <Button size="small" onClick={() => { setMerging(p.name); setMergeTarget('') }}>
                          Merge into…
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(`Delete project “${p.name}” and its ${p.count} notes?`)) {
                              onDelete(p.name)
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </Stack>
                    )}
                  </Stack>

                  {isRenaming && (
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                      <TextField
                        size="small"
                        fullWidth
                        label="Rename project"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        autoFocus
                      />
                      <Button
                        variant="contained"
                        size="small"
                        disabled={busy || !renameValue.trim() || renameValue.trim() === p.name}
                        onClick={() => {
                          onRename(p.name, renameValue.trim())
                          reset()
                        }}
                      >
                        Save
                      </Button>
                      <Button size="small" disabled={busy} onClick={() => setRenaming(null)}>
                        Cancel
                      </Button>
                    </Stack>
                  )}

                  {isDating && onSetExamDate && (
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                      <TextField
                        size="small"
                        type="date"
                        label={`Exam date for ${p.name}`}
                        value={dateValue}
                        onChange={(e) => setDateValue(e.target.value)}
                        InputLabelProps={{ shrink: true }}
                        sx={{ flex: 1 }}
                        autoFocus
                      />
                      <Button
                        variant="contained"
                        size="small"
                        disabled={busy || !dateValue || dateValue === (p.examDate ?? '')}
                        onClick={() => {
                          onSetExamDate(p.name, dateValue)
                          reset()
                        }}
                      >
                        Save
                      </Button>
                      {p.examDate && (
                        <Button
                          size="small"
                          color="inherit"
                          disabled={busy}
                          onClick={() => {
                            onSetExamDate(p.name, null)
                            reset()
                          }}
                        >
                          Clear
                        </Button>
                      )}
                      <Button size="small" disabled={busy} onClick={() => setDating(null)}>
                        Cancel
                      </Button>
                    </Stack>
                  )}

                  {isMerging && (
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                      <FormControl size="small" fullWidth>
                        <InputLabel id={`merge-target-${p.name}`}>Merge into</InputLabel>
                        <Select
                          labelId={`merge-target-${p.name}`}
                          label="Merge into"
                          value={mergeTarget}
                          onChange={(e) => setMergeTarget(String(e.target.value))}
                        >
                          {projects
                            .filter((o) => o.name !== p.name)
                            .map((o) => (
                              <MenuItem key={o.name} value={o.name}>
                                {o.name}
                              </MenuItem>
                            ))}
                        </Select>
                      </FormControl>
                      <Button
                        variant="contained"
                        size="small"
                        disabled={busy || !mergeTarget}
                        onClick={() => {
                          onMerge(p.name, mergeTarget)
                          reset()
                        }}
                      >
                        Merge
                      </Button>
                      <Button size="small" disabled={busy} onClick={() => setMerging(null)}>
                        Cancel
                      </Button>
                    </Stack>
                  )}
                </ListItem>
              )
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
