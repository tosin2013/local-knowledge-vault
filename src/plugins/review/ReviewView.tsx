import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import EventRepeatIcon from '@mui/icons-material/EventRepeat'
import AddIcon from '@mui/icons-material/Add'
import type { VaultPluginRenderProps } from '../types'
import { ProjectSelect } from '../../features/ProjectSelect'
import type { ReviewGrade, ReviewQueueItem, SearchHit } from '../../../electron/types'

/** The SM-2-style four-button scale; `again` is the leftmost (worst) grade. */
const GRADES: Array<{ grade: ReviewGrade; label: string }> = [
  { grade: 'again', label: 'Again' },
  { grade: 'hard', label: 'Hard' },
  { grade: 'good', label: 'Good' },
  { grade: 'easy', label: 'Easy' },
]

export function ReviewView({ onClose }: VaultPluginRenderProps) {
  const [due, setDue] = useState<ReviewQueueItem[]>([])
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const [targetDate, setTargetDate] = useState('')
  const [searchText, setSearchText] = useState('')
  const [results, setResults] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [added, setAdded] = useState<Record<string, boolean>>({})
  const [project, setProject] = useState('')

  const hasReviewApi = !!window.lkv?.review?.listDue
  const hasSearchApi = !!window.lkv?.search?.query

  const current = due[index] ?? null
  const remaining = Math.max(due.length - index, 0)

  const refresh = useCallback(async () => {
    if (!window.lkv?.review?.listDue) {
      setError('Review IPC is unavailable — restart Vault after updating.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const items = await window.lkv.review.listDue({ limit: 50, ...(project ? { project } : {}) })
      setDue(items)
      setIndex(0)
      setRevealed(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [project])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const recordGrade = async (grade: ReviewGrade) => {
    const item = current
    if (!item) return
    if (!window.lkv?.review?.rate) {
      setError('Review IPC is unavailable — restart Vault after updating.')
      return
    }
    setError(null)
    try {
      await window.lkv.review.rate({
        itemId: item.id,
        grade,
        targetDate: targetDate || undefined,
      })
      setIndex((i) => i + 1)
      setRevealed(false)
      setStatus(`Graded “${grade}”.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const runSearch = async () => {
    const text = searchText.trim()
    if (!text) {
      setResults([])
      return
    }
    if (!window.lkv?.search?.query) {
      setError('Search is unavailable — restart Vault after updating.')
      return
    }
    setSearching(true)
    setError(null)
    try {
      const { hits } = await window.lkv.search.query({ text, limit: 8 })
      setResults(hits)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSearching(false)
    }
  }

  const addToReview = async (hit: SearchHit) => {
    if (!window.lkv?.review?.enqueue) {
      setError('Review IPC is unavailable — restart Vault after updating.')
      return
    }
    setError(null)
    try {
      await window.lkv.review.enqueue({
        itemId: hit.id,
        targetDate: targetDate || undefined,
      })
      setAdded((prev) => ({ ...prev, [hit.id]: true }))
      setStatus(`Added “${hit.title}” to review.`)
      void refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, p: 1.5, gap: 1.5 }}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
        <EventRepeatIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
          Review
        </Typography>
        <Chip size="small" color={remaining > 0 ? 'primary' : 'default'} label={`${remaining} due`} />
        <Button size="small" onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
        {onClose && (
          <Button size="small" onClick={onClose}>
            Back to Ask
          </Button>
        )}
      </Stack>

      <Typography variant="body2" color="text.secondary">
        Try to recall each note from its title before revealing it. Rate how well you did and Vault
        schedules the next review.
      </Typography>

      <ProjectSelect value={project} onChange={setProject} label="Project" />

      {!hasReviewApi && (
        <Alert severity="warning">Review IPC unavailable — restart Vault after updating.</Alert>
      )}
      {status && (
        <Alert severity="success" onClose={() => setStatus(null)}>
          {status}
        </Alert>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Divider textAlign="left">
        <Typography variant="caption" color="text.secondary">
          Due now
        </Typography>
      </Divider>

      {!current ? (
        <Typography variant="body2" color="text.secondary">
          Nothing due.
        </Typography>
      ) : (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
              {current.title}
            </Typography>
            {revealed ? (
              <Box
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  p: 1.5,
                  bgcolor: 'background.default',
                  maxHeight: 280,
                  overflow: 'auto',
                }}
              >
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {current.body || 'This note has no body yet.'}
                </Typography>
              </Box>
            ) : (
              <Button variant="outlined" size="small" onClick={() => setRevealed(true)}>
                Show answer
              </Button>
            )}
          </CardContent>
          {revealed && (
            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ px: 2, pb: 2 }}>
              {GRADES.map(({ grade, label }) => (
                <Button
                  key={grade}
                  size="small"
                  variant={grade === 'good' ? 'contained' : 'outlined'}
                  onClick={() => void recordGrade(grade)}
                >
                  {label}
                </Button>
              ))}
            </Stack>
          )}
        </Card>
      )}

      <Divider textAlign="left">
        <Typography variant="caption" color="text.secondary">
          Add notes to review
        </Typography>
      </Divider>

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <TextField
          size="small"
          label="Search your notes"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch()
          }}
          inputProps={{ 'aria-label': 'Search your notes' }}
          sx={{ flex: 1, minWidth: 200 }}
        />
        <Button size="small" variant="contained" disabled={searching} onClick={() => void runSearch()}>
          {searching ? 'Searching…' : 'Search'}
        </Button>
        <TextField
          size="small"
          type="date"
          label="Target exam date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
          inputProps={{ 'aria-label': 'Target exam date' }}
          sx={{ width: 190 }}
        />
      </Stack>

      {results.length > 0 && (
        <Stack spacing={1}>
          {results.map((hit) => (
            <Stack
              key={hit.id}
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{ borderBottom: 1, borderColor: 'divider', pb: 0.5 }}
            >
              <Typography variant="body2" sx={{ flex: 1 }}>
                {hit.title}
              </Typography>
              <Button
                size="small"
                startIcon={<AddIcon />}
                disabled={added[hit.id]}
                onClick={() => void addToReview(hit)}
              >
                {added[hit.id] ? 'Added' : 'Add to review'}
              </Button>
            </Stack>
          ))}
        </Stack>
      )}

      <Typography variant="caption" color="text.secondary">
        Intervals are SM-2-style and expand as you recall a note; spacing your reviews beats cramming.
        A target exam date anchors the first interval to your deadline.
      </Typography>

      {!hasSearchApi && (
        <Typography variant="caption" color="text.secondary">
          Note search is unavailable in this build.
        </Typography>
      )}
    </Box>
  )
}
