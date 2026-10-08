import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import type {
  ReviewGrade,
  ReviewQueueItem,
  StudyCardQuestion,
  StudySessionReport,
} from '../../../electron/types'
import { STUDY_GRADES, gradeLabel } from './grades'

export interface StudySessionProps {
  /** The Study project ('' = every project). */
  project: string
  onOpenNote?: (id: string) => void
  /** Called after each grade, so the surrounding screen can refresh its numbers. */
  onGraded?: () => void
  /** Most cards in one session. */
  limit?: number
}

type Phase = 'idle' | 'starting' | 'card' | 'summary'

const ORIGIN_LABEL: Record<string, string> = {
  note: 'From your note',
  'practice-test': 'Practice test',
  reverse: 'List card',
}

function pct(v: number): string {
  return `${Math.round((v || 0) * 100)}%`
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "Fri, Oct 9, 9:00 AM" in the learner's locale. */
export function formatDue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * The Study session loop (#263). One card at a time: a free-recall question
 * written from the card's section (or the practice test's own question), an
 * attempt typed before anything is revealed (or an explicit "I don't know"),
 * a confidence rating, then the stored answer, the supporting quote and the
 * cited note as feedback, and a Missed / Partly / Got it grade that feeds the
 * exam-aware scheduler. A missed card comes back later in the session. The
 * summary shows grades, calibration (confident-but-missed cards first) and
 * what's next.
 *
 * Basis (docs/local-knowledge-vault-study-effects-on-learning.md §2, §5):
 * retrieval practice and free recall (Roediger & Karpicke 2006; Rowland 2014),
 * attempt before feedback (Kornell, Hays & Bjork 2009), feedback (Butler &
 * Roediger 2008), calibration (Bjork, Dunlosky & Kornell 2013). Every
 * Vault-specific effect is a hypothesis (#218).
 */
export function StudySession({ project, onOpenNote, onGraded, limit = 20 }: StudySessionProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [dueCount, setDueCount] = useState<number | null>(null)
  const [sessionId, setSessionId] = useState('')
  const [queue, setQueue] = useState<ReviewQueueItem[]>([])
  const [index, setIndex] = useState(0)
  const [questions, setQuestions] = useState<Record<string, StudyCardQuestion>>({})
  const pending = useRef<Record<string, Promise<StudyCardQuestion | null>>>({})
  const [attempt, setAttempt] = useState('')
  const [dontKnow, setDontKnow] = useState(false)
  const [confidence, setConfidence] = useState(50)
  const [revealed, setRevealed] = useState(false)
  const [showSection, setShowSection] = useState(false)
  const [grading, setGrading] = useState(false)
  const [report, setReport] = useState<StudySessionReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [empty, setEmpty] = useState(false)

  const api = window.lkv?.study
  const hasSessionApi = !!api?.startSession && !!api?.cardQuestion && !!api?.answer

  const refreshCount = useCallback(async () => {
    const count = window.lkv?.review?.count
    if (!count) return
    try {
      setDueCount(await count(project ? { project } : {}))
    } catch {
      setDueCount(null)
    }
  }, [project])

  // A new project means a new session.
  useEffect(() => {
    setPhase('idle')
    setQueue([])
    setReport(null)
    setEmpty(false)
    void refreshCount()
  }, [refreshCount])

  /** Fetch (once) the question for a card; later calls share the same promise. */
  const loadQuestion = useCallback((cardId: string): Promise<StudyCardQuestion | null> => {
    const get = window.lkv?.study?.cardQuestion
    if (!get) return Promise.resolve(null)
    if (!(cardId in pending.current)) {
      pending.current[cardId] = get(cardId)
        .then((q) => {
          setQuestions((prev) => ({ ...prev, [cardId]: q }))
          return q
        })
        .catch((e) => {
          delete pending.current[cardId]
          setError(e instanceof Error ? e.message : String(e))
          return null
        })
    }
    return pending.current[cardId]
  }, [])

  const current = phase === 'card' ? (queue[index] ?? null) : null
  const question = current ? questions[current.card_id] : undefined

  // Load the current card's question and quietly prepare the next one, so the
  // learner rarely waits on the model (one call per card, then cached).
  useEffect(() => {
    if (!current) return
    void loadQuestion(current.card_id)
    const next = queue[index + 1]
    if (next) void loadQuestion(next.card_id)
  }, [current, queue, index, loadQuestion])

  const resetCard = () => {
    setAttempt('')
    setDontKnow(false)
    setConfidence(50)
    setRevealed(false)
    setShowSection(false)
  }

  const start = async () => {
    if (!api?.startSession) {
      setError('Study sessions are unavailable — restart Vault after updating.')
      return
    }
    setPhase('starting')
    setError(null)
    setEmpty(false)
    setReport(null)
    try {
      const res = await api.startSession({ ...(project ? { project } : {}), limit })
      if (res.cards.length === 0) {
        setEmpty(true)
        setPhase('idle')
        return
      }
      pending.current = {}
      setQuestions({})
      setSessionId(res.sessionId)
      setQueue(res.cards)
      setIndex(0)
      resetCard()
      setPhase('card')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('idle')
    }
  }

  const finish = async (sid: string) => {
    setPhase('summary')
    void refreshCount()
    const summary = window.lkv?.study?.sessionSummary
    if (!summary) return
    try {
      setReport(await summary(sid, project || undefined))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const canReveal = !!question && (dontKnow || attempt.trim().length > 0)

  const grade = async (g: ReviewGrade) => {
    if (!current || !question || !api?.answer) return
    setGrading(true)
    setError(null)
    try {
      await api.answer({
        sessionId,
        cardId: current.card_id,
        question: question.question,
        attempt: attempt.trim(),
        dontKnow,
        confidence: dontKnow ? 0 : confidence,
        grade: g,
        answer: question.answer ?? question.quote ?? null,
      })
      onGraded?.()
      // A missed card comes back at the end of this session (#264).
      const nextQueue = g === 'again' ? [...queue, { ...current, last_grade: 'again' as const }] : queue
      if (g === 'again') setQueue(nextQueue)
      resetCard()
      if (index + 1 >= nextQueue.length) await finish(sessionId)
      else setIndex(index + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGrading(false)
    }
  }

  if (!hasSessionApi) {
    return <Alert severity="warning">Study sessions are unavailable — restart Vault after updating.</Alert>
  }

  return (
    <Box data-testid="study-session" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, flexShrink: 0 }}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {(phase === 'idle' || phase === 'starting') && (
        <Card variant="outlined" sx={{ flexShrink: 0 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600}>
              {dueCount ? `${plural(dueCount, 'card')} ready` : 'Study session'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              One question at a time. Answer from memory first, say how sure you are, then check it against your
              note and grade yourself.
            </Typography>
            {empty && (
              <Alert severity="info" sx={{ mb: 1.5 }}>
                Nothing is due right now. Vault spaces your reviews; add notes below or come back later.
              </Alert>
            )}
            <Button
              variant="contained"
              startIcon={phase === 'starting' ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
              disabled={phase === 'starting'}
              onClick={() => void start()}
            >
              {phase === 'starting' ? 'Starting…' : 'Start session'}
            </Button>
          </CardContent>
        </Card>
      )}

      {phase === 'card' && current && (
        <Card variant="outlined" sx={{ flexShrink: 0 }} key={`${current.card_id}-${index}`} data-testid="session-card">
          <LinearProgress variant="determinate" value={(index / Math.max(queue.length, 1)) * 100} />
          <CardContent>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                Card {index + 1} of {queue.length}
              </Typography>
              <Chip size="small" variant="outlined" label={ORIGIN_LABEL[current.origin] ?? 'Card'} />
              {current.chunk_index != null && current.chunk_count > 1 && (
                <Chip size="small" variant="outlined" label={`Part ${current.chunk_index + 1} of ${current.chunk_count}`} />
              )}
              {current.last_grade === 'again' && <Chip size="small" color="error" variant="outlined" label="Missed last time" />}
            </Stack>

            {!question ? (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">
                  Writing a question from your note…
                </Typography>
              </Stack>
            ) : (
              <>
                <Typography variant="h6" component="p" sx={{ mb: 1, lineHeight: 1.4 }} data-testid="session-question">
                  {question.question}
                </Typography>
                {question.notice && (
                  <Alert severity={question.offline || question.rateLimited ? 'warning' : 'info'} sx={{ mb: 1.5 }}>
                    {question.notice}
                  </Alert>
                )}

                {!revealed ? (
                  <>
                    <TextField
                      label="Your answer"
                      placeholder="Answer from memory before you look"
                      value={attempt}
                      onChange={(e) => setAttempt(e.target.value)}
                      multiline
                      minRows={2}
                      maxRows={6}
                      fullWidth
                      autoFocus
                      disabled={dontKnow}
                      inputProps={{ 'aria-label': 'Your answer' }}
                    />
                    <Box sx={{ mt: 1.5, maxWidth: 420 }}>
                      <Typography variant="caption" color="text.secondary" id="session-confidence-label">
                        {dontKnow ? 'Confidence: 0% (you don’t know yet)' : `How sure are you? ${confidence}%`}
                      </Typography>
                      <Slider
                        value={dontKnow ? 0 : confidence}
                        onChange={(_e, v) => setConfidence(Array.isArray(v) ? v[0] : v)}
                        min={0}
                        max={100}
                        step={10}
                        size="small"
                        disabled={dontKnow}
                        aria-label="Confidence"
                      />
                    </Box>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Button
                        size="small"
                        variant={dontKnow ? 'contained' : 'outlined'}
                        onClick={() => {
                          setDontKnow((v) => !v)
                          setAttempt('')
                        }}
                      >
                        I don&apos;t know
                      </Button>
                      <Button variant="contained" size="small" disabled={!canReveal} onClick={() => setRevealed(true)}>
                        Reveal answer
                      </Button>
                      {!canReveal && (
                        <Typography variant="caption" color="text.secondary">
                          Type your answer or choose “I don&apos;t know” first.
                        </Typography>
                      )}
                    </Stack>
                  </>
                ) : (
                  <Stack spacing={1.25} data-testid="session-reveal">
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Your answer · {dontKnow ? 'confidence 0%' : `confidence ${confidence}%`}
                      </Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {dontKnow ? 'I don’t know' : attempt.trim()}
                      </Typography>
                    </Box>
                    <Divider />
                    {question.answer && (
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Answer
                        </Typography>
                        <Typography variant="body1" fontWeight={600} data-testid="session-answer">
                          {question.answer}
                        </Typography>
                      </Box>
                    )}
                    {question.quote && (
                      <Box
                        component="blockquote"
                        sx={{ m: 0, pl: 1.5, borderLeft: 3, borderColor: 'primary.main', color: 'text.secondary' }}
                      >
                        <Typography variant="body2">“{question.quote}”</Typography>
                      </Box>
                    )}
                    {(question.kind === 'explain' || !question.answer) && (
                      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5, maxHeight: 260, overflow: 'auto' }}>
                        <Typography variant="caption" color="text.secondary">
                          Compare with your note
                        </Typography>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {question.sectionText || 'This note has no text yet.'}
                        </Typography>
                      </Box>
                    )}
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      {question.citations.map((c) => (
                        <Chip
                          key={c.id}
                          size="small"
                          color="primary"
                          variant="outlined"
                          icon={<OpenInNewIcon fontSize="small" />}
                          label={`Source: ${c.title}`}
                          onClick={onOpenNote ? () => onOpenNote(c.id) : undefined}
                          aria-label={`Open note ${c.title}`}
                        />
                      ))}
                      {question.kind !== 'explain' && question.answer && question.sectionText && (
                        <Button size="small" onClick={() => setShowSection((v) => !v)}>
                          {showSection ? 'Hide the section' : 'Show the whole section'}
                        </Button>
                      )}
                    </Stack>
                    <Collapse in={showSection} unmountOnExit>
                      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5, maxHeight: 260, overflow: 'auto' }}>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {question.sectionText}
                        </Typography>
                      </Box>
                    </Collapse>
                    <Typography variant="caption" color="text.secondary">
                      How did you do?
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      {STUDY_GRADES.map(({ grade: g, label }) => (
                        <Button
                          key={g}
                          size="small"
                          disabled={grading}
                          variant={g === 'good' ? 'contained' : 'outlined'}
                          color={g === 'again' ? 'error' : g === 'hard' ? 'warning' : 'primary'}
                          onClick={() => void grade(g)}
                        >
                          {label}
                        </Button>
                      ))}
                    </Stack>
                  </Stack>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {phase === 'summary' && (
        <Card variant="outlined" sx={{ flexShrink: 0 }} data-testid="session-summary">
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
              Session complete
            </Typography>
            {!report ? (
              <CircularProgress size={18} />
            ) : (
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap aria-label="Grades">
                  <Chip color="primary" label={`${gradeLabel('good')}: ${report.got}`} />
                  <Chip color="warning" variant="outlined" label={`${gradeLabel('hard')}: ${report.partial}`} />
                  <Chip color="error" variant="outlined" label={`${gradeLabel('again')}: ${report.missed}`} />
                  {report.retried > 0 && <Chip variant="outlined" label={`${plural(report.retried, 'card')} retried`} />}
                </Stack>
                <Typography variant="body2">
                  {plural(report.cards, 'card')} · first-try accuracy {pct(report.accuracy)}. You felt{' '}
                  {pct(report.calibration.meanConfidence)} sure on average and recalled {pct(report.calibration.meanScore)}
                  {report.calibration.bias > 0.1
                    ? ': a little overconfident.'
                    : report.calibration.bias < -0.1
                      ? ': you knew more than you thought.'
                      : ': well calibrated.'}
                </Typography>
                {report.confidentMisses.length > 0 && (
                  <Alert severity="warning" data-testid="confident-misses">
                    <Typography variant="body2" fontWeight={600}>
                      Confident but missed ({report.confidentMisses.length})
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', mb: 0.5 }}>
                      These felt known but weren&apos;t. They come back first next time.
                    </Typography>
                    <List dense disablePadding>
                      {report.confidentMisses.map((m) => (
                        <ListItemButton
                          key={m.cardId}
                          disableGutters
                          onClick={onOpenNote ? () => onOpenNote(m.itemId) : undefined}
                        >
                          <ListItemText
                            primary={m.question}
                            secondary={`${m.confidence}% sure · ${(m.grade === 'missed' ? 'Missed' : m.grade === 'partial' ? 'Partly' : 'Got it')} · ${m.title}`}
                          />
                        </ListItemButton>
                      ))}
                    </List>
                  </Alert>
                )}
                {report.revisit.length > 0 && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Notes to revisit
                    </Typography>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {report.revisit.map((r) => (
                        <Chip
                          key={r.itemId}
                          size="small"
                          variant="outlined"
                          label={r.title}
                          onClick={onOpenNote ? () => onOpenNote(r.itemId) : undefined}
                        />
                      ))}
                    </Stack>
                  </Box>
                )}
                <Typography variant="body2" color="text.secondary" data-testid="whats-next">
                  {report.nextDueAt
                    ? `What’s next: ${plural(report.dueByTomorrow, 'card')} due by tomorrow; the next one is due ${formatDue(report.nextDueAt)}.`
                    : report.dueByTomorrow > 0
                      ? `What’s next: ${plural(report.dueByTomorrow, 'card')} still due.`
                      : 'What’s next: nothing else is scheduled yet.'}
                </Typography>
              </Stack>
            )}
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Button variant="contained" size="small" startIcon={<PlayArrowIcon />} onClick={() => void start()}>
                Study more
              </Button>
              <Button size="small" onClick={() => setPhase('idle')}>
                Done
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}
    </Box>
  )
}
