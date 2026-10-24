import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import QuestionAnswerOutlinedIcon from '@mui/icons-material/QuestionAnswerOutlined'
import type { MediaBookmark } from '../../../electron/types'
import { BOOKMARK_TAGS, formatHms, sortBookmarks, tickPercent } from './bookmarks'

const CUSTOM = '__custom__'

const TAG_COLOR: Record<string, 'warning' | 'error' | 'info'> = {
  Confused: 'warning',
  Exam: 'error',
  Review: 'info',
}

/** Bookmark ticks under the player (#334): click one to seek there. */
export function BookmarkTimeline({
  bookmarks,
  durationSec,
  currentTime,
  onSeek,
}: {
  bookmarks: MediaBookmark[]
  durationSec: number | null
  currentTime: number
  onSeek: (sec: number) => void
}) {
  const playhead = tickPercent(currentTime, durationSec)
  if (playhead == null || bookmarks.length === 0) return null
  return (
    <Box
      data-testid="bookmark-timeline"
      aria-label="Bookmarks on the timeline"
      role="group"
      sx={{ position: 'relative', height: 14, mx: 0.5, borderRadius: 1, bgcolor: 'action.hover' }}
    >
      <Box
        aria-hidden
        sx={{ position: 'absolute', left: 0, top: 5, height: 4, width: `${playhead}%`, borderRadius: 1, bgcolor: 'primary.light', opacity: 0.6 }}
      />
      {bookmarks.map((b) => {
        const pct = tickPercent(b.positionSec, durationSec) ?? 0
        const name = `Bookmark at ${formatHms(b.positionSec)}${b.label ? ` — ${b.label}` : ''}`
        return (
          <Tooltip key={b.id} title={name}>
            <Box
              component="button"
              type="button"
              aria-label={name}
              data-testid="bookmark-tick"
              data-pct={pct.toFixed(2)}
              onClick={() => onSeek(b.positionSec)}
              sx={{
                position: 'absolute',
                left: `calc(${pct}% - 2px)`,
                top: 0,
                width: 4,
                height: 14,
                p: 0,
                border: 0,
                borderRadius: 0.5,
                cursor: 'pointer',
                bgcolor: b.tag && TAG_COLOR[b.tag] ? `${TAG_COLOR[b.tag]}.main` : 'secondary.main',
              }}
            />
          </Tooltip>
        )
      })}
    </Box>
  )
}

interface EditorProps {
  bookmark: MediaBookmark
  onSave: (patch: { label: string; tag: string | null }) => void
  onCancel: () => void
}

function BookmarkEditor({ bookmark, onSave, onCancel }: EditorProps) {
  const builtIn = (BOOKMARK_TAGS as readonly string[]).includes(bookmark.tag ?? '')
  const [label, setLabel] = useState(bookmark.label)
  const [tagChoice, setTagChoice] = useState<string>(bookmark.tag == null ? '' : builtIn ? bookmark.tag : CUSTOM)
  const [custom, setCustom] = useState(builtIn ? '' : (bookmark.tag ?? ''))
  const save = () => onSave({ label: label.trim(), tag: tagChoice === CUSTOM ? custom.trim() || null : tagChoice || null })
  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ width: '100%' }}>
      <TextField
        size="small"
        label="Label"
        value={label}
        autoFocus
        inputProps={{ maxLength: 120, 'aria-label': 'Bookmark label' }}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            save()
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
        sx={{ flex: '1 1 160px' }}
      />
      <TextField
        select
        size="small"
        label="Tag"
        value={tagChoice}
        onChange={(e) => setTagChoice(e.target.value)}
        SelectProps={{ inputProps: { 'aria-label': 'Bookmark tag' } }}
        sx={{ minWidth: 120 }}
      >
        <MenuItem value="">
          <em>None</em>
        </MenuItem>
        {BOOKMARK_TAGS.map((t) => (
          <MenuItem key={t} value={t}>
            {t}
          </MenuItem>
        ))}
        <MenuItem value={CUSTOM}>Custom…</MenuItem>
      </TextField>
      {tagChoice === CUSTOM && (
        <TextField
          size="small"
          label="Custom tag"
          value={custom}
          inputProps={{ maxLength: 24, 'aria-label': 'Custom tag' }}
          onChange={(e) => setCustom(e.target.value)}
          sx={{ width: 140 }}
        />
      )}
      <Button size="small" variant="contained" onClick={save}>
        Save
      </Button>
      <Button size="small" onClick={onCancel}>
        Cancel
      </Button>
    </Stack>
  )
}

export interface BookmarksPanelProps {
  bookmarks: MediaBookmark[]
  busy?: boolean
  /** The bookmark whose label/tag editor is open (a new one opens it). */
  editingId: string | null
  onEdit: (id: string | null) => void
  onAdd: () => void
  onSeek: (sec: number) => void
  onUpdate: (id: string, patch: { label: string; tag: string | null }) => void
  onDelete: (id: string) => void
  onAsk: (b: MediaBookmark) => void
  onSummarize: () => void
  onMakeCards: () => void
  /** Save the bookmarks as a Markdown note in the project (export). */
  onSaveAsNote?: () => void
  /** Taller list when the player has the room (fullscreen). */
  large?: boolean
}

/** The bookmarks list (#334): time, label, tag and transcript; click a time to seek. */
export function BookmarksPanel(props: BookmarksPanelProps) {
  const { bookmarks, busy, editingId, onEdit, onAdd, onSeek, onUpdate, onDelete, onAsk, onSummarize, onMakeCards, onSaveAsNote, large } = props
  const list = sortBookmarks(bookmarks)
  const withoutCard = list.filter((b) => !b.cardId).length
  // Close the editor when its bookmark disappears.
  useEffect(() => {
    if (editingId && !bookmarks.some((b) => b.id === editingId)) onEdit(null)
  }, [bookmarks, editingId, onEdit])

  return (
    <Paper variant="outlined" sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }} data-testid="bookmarks-panel">
      <Stack direction="row" alignItems="center" spacing={0.5} flexWrap="wrap" useFlexGap>
        <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 120 }}>
          Bookmarks{list.length > 0 ? ` (${list.length})` : ''}
        </Typography>
        <Button size="small" variant="outlined" startIcon={<BookmarkAddIcon fontSize="small" />} disabled={busy} onClick={onAdd}>
          Bookmark (B)
        </Button>
        {list.length > 0 && (
          <>
            <Button size="small" disabled={busy} onClick={onSummarize}>
              Summarize my bookmarks
            </Button>
            <Tooltip title={withoutCard === 0 ? 'Every bookmark already has a Study card' : 'One Study card per bookmark, from the transcript around it'}>
              <span>
                <Button size="small" disabled={busy || withoutCard === 0} onClick={onMakeCards}>
                  Make cards from bookmarks
                </Button>
              </span>
            </Tooltip>
            {onSaveAsNote && (
              <Button size="small" disabled={busy} onClick={onSaveAsNote}>
                Save as note
              </Button>
            )}
          </>
        )}
      </Stack>
      {list.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          Press B (or the button) to bookmark this moment. Bookmarks stay with this video.
        </Typography>
      ) : (
        <Stack component="ul" spacing={0.5} sx={{ listStyle: 'none', m: 0, p: 0, maxHeight: large ? 260 : 200, overflow: 'auto' }}>
          {list.map((b) => (
            <Box
              component="li"
              key={b.id}
              data-testid="bookmark-row"
              sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, py: 0.5, borderBottom: 1, borderColor: 'divider' }}
            >
              {editingId === b.id ? (
                <BookmarkEditor
                  bookmark={b}
                  onCancel={() => onEdit(null)}
                  onSave={(patch) => {
                    onUpdate(b.id, patch)
                    onEdit(null)
                  }}
                />
              ) : (
                <Stack direction="row" alignItems="center" spacing={0.75} useFlexGap flexWrap="wrap">
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    label={formatHms(b.positionSec)}
                    onClick={() => onSeek(b.positionSec)}
                    aria-label={`Seek to ${formatHms(b.positionSec)}`}
                    sx={{ fontVariantNumeric: 'tabular-nums' }}
                  />
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 80 }} noWrap title={b.label || undefined}>
                    {b.label || <Box component="span" sx={{ color: 'text.secondary' }}>No label</Box>}
                  </Typography>
                  {b.tag && <Chip size="small" label={b.tag} color={TAG_COLOR[b.tag] ?? 'default'} />}
                  {b.cardId && <Chip size="small" variant="outlined" label="Card" title="Has a Study card" />}
                  <Tooltip title="Ask about this bookmark">
                    <span>
                      <IconButton size="small" disabled={busy} onClick={() => onAsk(b)} aria-label={`Ask about the bookmark at ${formatHms(b.positionSec)}`}>
                        <QuestionAnswerOutlinedIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <IconButton size="small" onClick={() => onEdit(b.id)} aria-label={`Edit the bookmark at ${formatHms(b.positionSec)}`}>
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" onClick={() => onDelete(b.id)} aria-label={`Delete the bookmark at ${formatHms(b.positionSec)}`}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
              )}
              {b.transcriptLine && (
                <Typography variant="caption" color="text.secondary" sx={{ pl: 0.5 }} noWrap title={b.transcriptLine}>
                  {b.transcriptLine}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Paper>
  )
}
