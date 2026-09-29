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

export interface ManageProjectsDialogProps {
  open: boolean
  projects: ProjectSummary[]
  busy: boolean
  onClose: () => void
  onRename: (from: string, to: string) => void
  onMerge: (from: string, into: string) => void
  onDelete: (name: string) => void
}

/** Rename / merge / delete the first-class projects (each derived from note count). */
export function ManageProjectsDialog(props: ManageProjectsDialogProps) {
  const { open, projects, busy, onClose, onRename, onMerge, onDelete } = props

  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [merging, setMerging] = useState<string | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')

  const reset = () => {
    setRenaming(null)
    setRenameValue('')
    setMerging(null)
    setMergeTarget('')
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
              return (
                <ListItem
                  key={p.name}
                  disableGutters
                  sx={{ flexDirection: 'column', alignItems: 'stretch', py: 1 }}
                >
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <ListItemText
                      primary={p.name}
                      secondary={`${p.count} note${p.count === 1 ? '' : 's'}`}
                    />
                    {!isRenaming && !isMerging && (
                      <Stack direction="row" spacing={0.5}>
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
