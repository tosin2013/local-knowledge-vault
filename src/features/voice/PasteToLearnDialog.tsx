import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { Item } from '../../../electron/types'

export interface PasteToLearnDialogProps {
  open: boolean
  /** The project the new note goes in ('' = none). */
  project: string
  onClose: () => void
  onSaved: (item: Item) => void
}

/**
 * "Paste notes to learn" (#418): the pasted text is saved as an ordinary note
 * first (an explicit Save, like a new note), so the lesson can cite it.
 */
export function PasteToLearnDialog({ open, project, onClose, onSaved }: PasteToLearnDialogProps) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTitle('')
      setBody('')
      setError(null)
    }
  }, [open])

  const save = async () => {
    if (!window.lkv?.items?.create) return
    setBusy(true)
    setError(null)
    try {
      const item = await window.lkv.items.create({
        title: title.trim() || 'Untitled',
        body: body.trim(),
        kind: 'note',
        status: 'active',
        project: project || null,
      })
      onSaved(item)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="paste-learn-title">
      <DialogTitle id="paste-learn-title">Paste notes to learn</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
          Vault saves this as a note{project ? ` in ${project}` : ''} so the lesson can point back to it. You can edit or
          delete it later in Notes.
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {error}
          </Alert>
        )}
        <TextField
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          fullWidth
          size="small"
          sx={{ mb: 1.5 }}
        />
        <TextField
          label="Notes"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          fullWidth
          multiline
          minRows={6}
          placeholder="Paste lecture notes, a reading summary, or anything you want to learn"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy || !body.trim()} onClick={() => void save()}>
          Save note and teach me
        </Button>
      </DialogActions>
    </Dialog>
  )
}
