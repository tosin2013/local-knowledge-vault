import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Collapse,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import type { ProjectSummary, StudyEnrollResult, StudyStats } from '../../../electron/types'
import { ProjectSelect } from '../ProjectSelect'
import { ExamDateControl } from './ExamDateControl'
import { daysToExam, daysToGoLabel, formatExamDate } from './examDate'

export interface StudyHomeProps {
  project: string
  onProjectChange: (project: string) => void
  /** Switch to the Review section. */
  onStartReview: () => void
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "12 notes → 30 cards, 3 skipped" (#262). */
export function enrollSummary(r: StudyEnrollResult): string {
  return `${plural(r.notes, 'note')} → ${plural(r.cards, 'card')}, ${r.skipped.length} skipped`
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, minWidth: 130, flex: '1 1 130px' }} aria-label={label}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h6" component="p" fontWeight={600} sx={{ lineHeight: 1.3 }}>
        {value}
      </Typography>
      {detail && (
        <Typography variant="caption" color="text.secondary">
          {detail}
        </Typography>
      )}
    </Paper>
  )
}

/**
 * Study home (#262): pick a project (a course or exam), see where you stand —
 * exam date, days to go, cards due, total cards, last session — and enroll
 * the whole project with one click.
 */
export function StudyHome({ project, onProjectChange, onStartReview }: StudyHomeProps) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [stats, setStats] = useState<StudyStats | null>(null)
  const [enrolling, setEnrolling] = useState(false)
  const [result, setResult] = useState<StudyEnrollResult | null>(null)
  const [showSkipped, setShowSkipped] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const get = window.lkv?.review?.stats
    if (!get) return
    try {
      setStats(await get(project || undefined))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [project])

  useEffect(() => {
    setResult(null)
    setShowSkipped(false)
    void refresh()
  }, [refresh])

  const studyProject = async () => {
    const enqueue = window.lkv?.review?.enqueueProject
    if (!enqueue || !project) return
    setEnrolling(true)
    setError(null)
    try {
      setResult(await enqueue(project))
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setEnrolling(false)
    }
  }

  const skippedByReason = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of result?.skipped ?? []) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [result])

  const noProjects = projects !== null && projects.length === 0
  const days = daysToExam(stats?.examDate)
  const last = stats?.lastSession ?? null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, p: 1.5 }} data-testid="study-home">
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <ProjectSelect
          value={project}
          onChange={onProjectChange}
          label="Course or exam (project)"
          onProjectsLoaded={setProjects}
        />
        <ExamDateControl project={project} onChange={() => void refresh()} />
      </Stack>

      {noProjects && (
        <Alert severity="info">
          No projects yet. Give your notes a project (the Project picker on a note, or an import) and each project
          becomes a course you can study for an exam.
        </Alert>
      )}
      {!noProjects && !project && (
        <Typography variant="body2" color="text.secondary">
          Pick the project for your course or exam to set its exam date and enroll its notes. The numbers below
          cover every project.
        </Typography>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {stats && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap data-testid="study-stats">
          <Stat
            label="Exam"
            value={stats.examDate ? formatExamDate(stats.examDate) : 'No date'}
            detail={stats.examDate ? daysToGoLabel(days) : project ? 'Set one above' : 'Pick a project'}
          />
          <Stat label="Due now" value={String(stats.due)} detail={plural(stats.newCards, 'new card')} />
          <Stat
            label="Cards"
            value={String(stats.totalCards)}
            detail={`from ${stats.enrolledNotes} of ${plural(stats.liveNotes, 'note')}`}
          />
          <Stat
            label="Last session"
            value={last ? `${Math.round(last.score * 100)}%` : '—'}
            detail={
              last
                ? `${last.got} of ${last.reviewed} recalled · ${new Date(last.endedAt).toLocaleDateString()}`
                : 'No sessions yet'
            }
          />
        </Stack>
      )}

      {project && stats && stats.liveNotes === 0 && (
        <Alert severity="info">
          {project} has no notes yet. Import a PDF or add notes to it, then come back to study it.
        </Alert>
      )}

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button
          variant="contained"
          startIcon={<PlaylistAddCheckIcon />}
          disabled={!project || enrolling || !stats || stats.liveNotes === 0}
          onClick={() => void studyProject()}
        >
          {enrolling ? 'Adding…' : 'Study this project'}
        </Button>
        <Button
          variant="outlined"
          startIcon={<PlayArrowIcon />}
          disabled={!stats || stats.due === 0}
          onClick={onStartReview}
        >
          {stats && stats.due > 0 ? `Review ${plural(stats.due, 'due card')}` : 'Nothing due'}
        </Button>
      </Stack>
      {!project && !noProjects && (
        <Typography variant="caption" color="text.secondary">
          Study this project needs a project: it adds every note in it to review.
        </Typography>
      )}
      {stats && stats.totalCards > 0 && stats.due === 0 && (
        <Typography variant="body2" color="text.secondary">
          Nothing due right now. Vault spaces your reviews; come back when cards are due.
        </Typography>
      )}

      {result && (
        <Alert severity={result.notes > 0 ? 'success' : 'info'} onClose={() => setResult(null)}>
          <Typography variant="body2" fontWeight={600}>
            {enrollSummary(result)}
          </Typography>
          {result.alreadyScheduled > 0 && (
            <Typography variant="body2">
              {plural(result.alreadyScheduled, 'note')} {result.alreadyScheduled === 1 ? 'was' : 'were'} already
              scheduled and left as they are.
            </Typography>
          )}
          {skippedByReason.length > 0 && (
            <>
              <Typography variant="body2">
                Skipped: {skippedByReason.map(([reason, n]) => `${n} ${reason}`).join('; ')}.
              </Typography>
              <Button size="small" onClick={() => setShowSkipped((v) => !v)} sx={{ px: 0 }}>
                {showSkipped ? 'Hide skipped notes' : 'Show skipped notes'}
              </Button>
              <Collapse in={showSkipped}>
                <List dense disablePadding aria-label="Skipped notes">
                  {result.skipped.map((s) => (
                    <ListItem key={s.itemId} disableGutters>
                      <ListItemText primary={s.title} secondary={s.reason} />
                    </ListItem>
                  ))}
                </List>
              </Collapse>
            </>
          )}
        </Alert>
      )}

      <Typography variant="caption" color="text.secondary">
        Each short note becomes one card; a long note or imported page becomes one card per section. Until
        questions are generated, Review prompts with each note&apos;s summary.
      </Typography>
    </Box>
  )
}
