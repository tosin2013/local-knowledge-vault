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
import type { VaultPluginRenderProps } from '../../plugins/types'
import { ProjectSelect } from '../ProjectSelect'
import { ExamDateControl } from './ExamDateControl'
import { useStudyProject, type StudyProjectProps } from './useStudyProject'
import type { ReviewGrade, ReviewQueueItem, SearchHit, StudyStats } from '../../../electron/types'
import { STUDY_GRADES, gradeLabel } from './grades'
import { NEW_CARDS_PER_DAY_MAX } from './examDate'


export type ReviewViewProps = VaultPluginRenderProps & StudyProjectProps

export function ReviewView({ onClose, project: projectProp, onProjectChange }: ReviewViewProps) {
  const [due, setDue] = useState<ReviewQueueItem[]>([])
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const [searchText, setSearchText] = useState('')
  const [results, setResults] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [added, setAdded] = useState<Record<string, boolean>>({})
  const [project, setProject] = useStudyProject(projectProp, onProjectChange)
  const [stats, setStats] = useState<StudyStats | null>(null)

  const hasReviewApi = !!window.lkv?.review?.listDue
  const hasSearchApi = !!window.lkv?.search?.query

  const current = due[index] ?? null
  const remaining = Math.max(due.length - index, 0)

  // The new-card budget and coverage warning for this scope (#264).
  const refreshStats = useCallback(async () => {
    const getStats = window.lkv?.review?.stats
    setStats(getStats ? await getStats(project || undefined).catch(() => null) : null)
  }, [project])

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
      void refreshStats()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [project, refreshStats])

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
      await window.lkv.review.rate({ cardId: item.card_id, grade })
      // A missed card comes back at the end of this session (#264).
      if (grade === 'again') setDue((d) => [...d, { ...item, last_grade: 'again' }])
      setIndex((i) => i + 1)
      setRevealed(false)
      setStatus(grade === 'again' ? 'Missed: it comes back later in this session.' : `Graded “${gradeLabel(grade)}”.`)
      void refreshStats()
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
      // Scoped to the picked project (#262); "All projects" searches everything.
      const { hits } = await window.lkv.search.query({ text, limit: 8, ...(project ? { filters: { project } } : {}) })
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
      const res = await window.lkv.review.enqueue({ itemId: hit.id })
      setAdded((prev) => ({ ...prev, [hit.id]: true }))
      setStatus(
        res?.alreadyEnrolled
          ? `“${hit.title}” is already in review.`
          : res && res.created > 1
            ? `Added “${hit.title}” to review as ${res.created} cards (one per section).`
            : `Added “${hit.title}” to review.`,
      )
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

      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <ProjectSelect value={project} onChange={setProject} label="Project" />
        <ExamDateControl project={project} />
      </Stack>

      {stats && stats.unreachable > 0 && (
        <Alert severity="warning" data-testid="coverage-warning">
          {stats.unreachable} {stats.unreachable === 1 ? 'card' : 'cards'} won&apos;t be reached before your exam at{' '}
          {NEW_CARDS_PER_DAY_MAX} new cards a day. Study the rest from the notes directly, or move the exam date.
        </Alert>
      )}
      {stats && stats.newPerDay > 0 && (
        <Typography variant="caption" color="text.secondary" data-testid="new-budget">
          New cards today: {stats.newLeftToday} of {stats.newPerDay}. Missed cards come first, then due cards, then
          new ones.
        </Typography>
      )}

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
        <Card variant="outlined" sx={{ flexShrink: 0 }} key={current.card_id}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
              {current.question?.trim() || current.summary?.trim() || current.title}
            </Typography>
            {current.chunk_index != null && current.chunk_count > 1 && (
              <Chip
                size="small"
                variant="outlined"
                sx={{ mb: 1 }}
                label={`Part ${current.chunk_index + 1} of ${current.chunk_count}`}
              />
            )}
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
                  {current.card_text || 'This note has no body yet.'}
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
              {STUDY_GRADES.map(({ grade, label }) => (
                <Button
                  key={grade}
                  size="small"
                  variant={grade === 'good' ? 'contained' : 'outlined'}
                  color={grade === 'again' ? 'error' : grade === 'hard' ? 'warning' : 'primary'}
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
        With a project exam date, the first interval is anchored to it and no review is scheduled past it;
        the last one lands the day before.
      </Typography>

      {!hasSearchApi && (
        <Typography variant="caption" color="text.secondary">
          Note search is unavailable in this build.
        </Typography>
      )}
    </Box>
  )
}
