import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, Chip, Divider, Stack, TextField, Typography } from '@mui/material'
import SchoolIcon from '@mui/icons-material/School'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import type { VaultPluginRenderProps } from '../../plugins/types'
import { ProjectSelect } from '../ProjectSelect'
import { ExamDateControl } from './ExamDateControl'
import { useStudyProject, type StudyProjectProps } from './useStudyProject'
import type { SearchHit, StudyStats } from '../../../electron/types'
import { NEW_CARDS_PER_DAY_MAX } from './examDate'
import { StudySession } from './StudySession'

export type ReviewViewProps = VaultPluginRenderProps & StudyProjectProps

/**
 * The Study session section (#263): project and exam date, the new-card
 * budget, the session loop itself ({@link StudySession}) and a note search to
 * add single notes. A note that already has cards says "Already in Study"
 * instead of offering to add it again.
 */
export function ReviewView({ onClose, onOpenNote, project: projectProp, onProjectChange }: ReviewViewProps) {
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const [searchText, setSearchText] = useState('')
  const [results, setResults] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [added, setAdded] = useState<Record<string, boolean>>({})
  const [enrolled, setEnrolled] = useState<Record<string, boolean>>({})
  const [project, setProject] = useStudyProject(projectProp, onProjectChange)
  const [stats, setStats] = useState<StudyStats | null>(null)
  const [sessionKey, setSessionKey] = useState(0)

  const hasSearchApi = !!window.lkv?.search?.query

  // The new-card budget and coverage warning for this scope (#264).
  const refreshStats = useCallback(async () => {
    const getStats = window.lkv?.review?.stats
    setStats(getStats ? await getStats(project || undefined).catch(() => null) : null)
  }, [project])

  useEffect(() => {
    void refreshStats()
  }, [refreshStats])

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
      // Which of these already have cards, so they read "Already in Study".
      const check = window.lkv?.review?.enrolled
      if (check && hits.length > 0) {
        const ids = await check(hits.map((h) => h.id)).catch(() => [] as string[])
        setEnrolled(Object.fromEntries(ids.map((id) => [id, true])))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSearching(false)
    }
  }

  const addToReview = async (hit: SearchHit) => {
    if (!window.lkv?.review?.enqueue) {
      setError('Study is unavailable — restart Vault after updating.')
      return
    }
    setError(null)
    try {
      const res = await window.lkv.review.enqueue({ itemId: hit.id })
      if (res?.alreadyEnrolled) {
        setEnrolled((prev) => ({ ...prev, [hit.id]: true }))
        setStatus(`“${hit.title}” is already in Study.`)
        return
      }
      setAdded((prev) => ({ ...prev, [hit.id]: true }))
      setStatus(
        res && res.created > 1
          ? `Added “${hit.title}” to Study as ${res.created} cards (one per section).`
          : `Added “${hit.title}” to Study.`,
      )
      void refreshStats()
      setSessionKey((k) => k + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, p: 1.5, gap: 1.5, overflow: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
        <SchoolIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
          Study session
        </Typography>
        {stats && <Chip size="small" color={stats.due > 0 ? 'primary' : 'default'} label={`${stats.due} due`} />}
        {onClose && (
          <Button size="small" onClick={onClose}>
            Back to Ask
          </Button>
        )}
      </Stack>

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

      <StudySession key={`${project}-${sessionKey}`} project={project} onOpenNote={onOpenNote} onGraded={() => void refreshStats()} />

      <Divider textAlign="left">
        <Typography variant="caption" color="text.secondary">
          Add notes to Study
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
              {enrolled[hit.id] ? (
                <Chip size="small" icon={<CheckIcon />} label="Already in Study" variant="outlined" />
              ) : (
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  disabled={added[hit.id]}
                  onClick={() => void addToReview(hit)}
                >
                  {added[hit.id] ? 'Added' : 'Add to review'}
                </Button>
              )}
            </Stack>
          ))}
        </Stack>
      )}

      <Typography variant="caption" color="text.secondary">
        Intervals are SM-2-style and expand as you recall a card; spacing your reviews beats cramming.
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
