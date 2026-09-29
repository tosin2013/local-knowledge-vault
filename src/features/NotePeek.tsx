import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import type { Item, Para } from '../../electron/types'
import { AI_DRAFT_STATUS, NEW_DRAFT_ID, PARA_OPTIONS, paraLabel } from '../domain'

export interface NotePeekProps {
  open: boolean
  isNewDraft: boolean
  draft: Item | null
  peekEditing: boolean
  dirty: boolean
  busy: boolean
  advanced: boolean
  projectOptions: string[]
  onClose: () => void
  onEdit: (editing: boolean) => void
  onPatch: <K extends keyof Item>(key: K, value: Item[K]) => void
  onSave: () => void
  onDelete: () => void
  onConfirmDraft: () => void
  onCopyId: (id: string) => void
}

export function NotePeek(props: NotePeekProps) {
  const {
    open,
    isNewDraft,
    draft,
    peekEditing,
    dirty,
    busy,
    advanced,
    projectOptions,
    onClose,
    onEdit,
    onPatch,
    onSave,
    onDelete,
    onConfirmDraft,
    onCopyId,
  } = props

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      variant="temporary"
      ModalProps={{
        keepMounted: true,
        disablePortal: true,
        sx: { position: 'absolute' },
      }}
      slotProps={{
        backdrop: {
          sx: {
            position: 'absolute',
            bgcolor: 'rgba(0, 0, 0, 0.28)',
          },
        },
      }}
      PaperProps={{
        sx: {
          position: 'absolute',
          width: { xs: '100%', sm: 420, md: 480 },
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
      aria-label="Note peek"
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
      >
        <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }} noWrap>
          {isNewDraft || draft?.id === NEW_DRAFT_ID
            ? 'New note'
            : peekEditing
              ? 'Editing note'
              : 'Viewing note'}
        </Typography>
        {draft && draft.status === AI_DRAFT_STATUS && (
          <Chip size="small" color="warning" variant="outlined" label="AI draft" />
        )}
        {!peekEditing && draft && (
          <>
            <Button
              size="small"
              startIcon={<EditOutlinedIcon />}
              onClick={() => onEdit(true)}
            >
              Edit
            </Button>
            {!isNewDraft && draft.id !== NEW_DRAFT_ID && (
              <Button size="small" color="error" onClick={onDelete}>
                Delete
              </Button>
            )}
          </>
        )}
        <IconButton size="small" aria-label="Close note peek" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Box className="panel" sx={{ p: 2, flex: 1, minHeight: 0, overflow: 'auto' }}>
        {!draft ? (
          <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Loading note…
            </Typography>
          </Box>
        ) : (
          <Box className="editor">
            <TextField
              fullWidth
              value={draft.title}
              onChange={(e) => onPatch('title', e.target.value)}
              placeholder="Title"
              aria-label="Note title"
            />
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1 }}>
              <FormControl fullWidth size="small" disabled={!peekEditing}>
                <InputLabel id="peek-para-label">Group</InputLabel>
                <Select
                  labelId="peek-para-label"
                  label="Group"
                  value={draft.para}
                  onChange={(e) => onPatch('para', e.target.value as Para)}
                >
                  {PARA_OPTIONS.filter(Boolean).map((p) => (
                    <MenuItem key={p} value={p}>
                      {paraLabel(p as string)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label="Type"
                size="small"
                value={draft.kind}
                onChange={(e) => onPatch('kind', e.target.value)}
                InputProps={{ readOnly: !peekEditing }}
              />
              <TextField
                label="Status"
                size="small"
                value={draft.status}
                onChange={(e) => onPatch('status', e.target.value)}
                InputProps={{ readOnly: !peekEditing }}
              />
              <Autocomplete
                freeSolo
                size="small"
                disabled={!peekEditing}
                options={projectOptions}
                value={draft.project ?? ''}
                onInputChange={(_e, value) => onPatch('project', value ? String(value) : null)}
                renderInput={(params) => (
                  <TextField {...params} label="Project" placeholder="New or existing project" />
                )}
              />
            </Box>
            <TextField
              fullWidth
              label="Summary"
              size="small"
              value={draft.summary ?? ''}
              onChange={(e) => onPatch('summary', e.target.value || null)}
              InputProps={{ readOnly: !peekEditing }}
            />
            <TextField
              className="body-field"
              fullWidth
              multiline
              minRows={12}
              value={draft.body}
              onChange={(e) => onPatch('body', e.target.value)}
              placeholder="Write your note…"
              aria-label="Note body"
              InputProps={{ readOnly: !peekEditing }}
              sx={{ flex: 1, '& .MuiInputBase-root': { alignItems: 'flex-start' } }}
            />
            <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center" flexWrap="wrap">
              <Typography variant="body2" color="text.secondary" sx={{ mr: 'auto' }}>
                {advanced && !isNewDraft && draft.id !== NEW_DRAFT_ID && (
                  <>
                    <Box component="code" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {draft.id}
                    </Box>
                    <Button size="small" onClick={() => onCopyId(draft.id)}>
                      Copy id
                    </Button>
                    {' · '}
                  </>
                )}
                {isNewDraft || draft.id === NEW_DRAFT_ID
                  ? dirty
                    ? 'Draft — not saved yet'
                    : 'Draft — save to add to your vault'
                  : dirty
                    ? 'Unsaved changes'
                    : peekEditing
                      ? 'Saved'
                      : 'Viewing'}
              </Typography>
              {peekEditing && (
                <>
                  {!isNewDraft && draft.id !== NEW_DRAFT_ID && draft.status === AI_DRAFT_STATUS && (
                    <Button color="warning" variant="outlined" disabled={busy} onClick={onConfirmDraft}>
                      Confirm draft
                    </Button>
                  )}
                  {!isNewDraft && draft.id !== NEW_DRAFT_ID && (
                    <Button color="error" variant="outlined" onClick={onDelete}>
                      Delete
                    </Button>
                  )}
                </>
              )}
              {(peekEditing || dirty) && (
                <Button
                  variant="contained"
                  disabled={busy || (!dirty && !isNewDraft && draft.id !== NEW_DRAFT_ID)}
                  onClick={onSave}
                >
                  Save
                </Button>
              )}
            </Stack>
          </Box>
        )}
      </Box>
    </Drawer>
  )
}
