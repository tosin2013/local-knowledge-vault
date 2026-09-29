import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material'
import RestoreIcon from '@mui/icons-material/Restore'
import DeleteForeverIcon from '@mui/icons-material/DeleteForever'
import type { Item } from '../../electron/types'

export interface TrashDialogProps {
  open: boolean
  items: Item[]
  busy: boolean
  onClose: () => void
  onRestore: (id: string) => void
  onEmpty: () => void
}

/** Soft-deleted notes: restore or permanently empty. */
export function TrashDialog(props: TrashDialogProps) {
  const { open, items, busy, onClose, onRestore, onEmpty } = props

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Trash</DialogTitle>
      <DialogContent dividers>
        {items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Trash is empty.
          </Typography>
        ) : (
          <List dense disablePadding>
            {items.map((it) => (
              <ListItem
                key={it.id}
                disableGutters
                secondaryAction={
                  <Button size="small" startIcon={<RestoreIcon />} disabled={busy} onClick={() => onRestore(it.id)}>
                    Restore
                  </Button>
                }
              >
                <ListItemText primary={it.title} secondary={it.kind} />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          color="error"
          startIcon={<DeleteForeverIcon />}
          disabled={busy || items.length === 0}
          onClick={() => {
            if (window.confirm(`Permanently delete all ${items.length} trashed note${items.length === 1 ? '' : 's'}?`)) {
              onEmpty()
            }
          }}
        >
          Empty trash
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
