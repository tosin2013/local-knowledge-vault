/**
 * Exam tutor quiz loop (#364): quiz before telling.
 *
 * attempt (or "I don't know" / "Just show me") → confidence (Low / Medium /
 * High) → reveal (grade, cited answer, timestamp to rewatch) → why-prompt for
 * a right or partly right answer → practice offer for a miss.
 *
 * The renderer never holds the answer before the reveal: the question comes
 * from `media.tutorQuiz` without it, and `media.tutorReveal` (which needs the
 * attempt and the confidence) is the only call that returns it.
 */
import { useState } from 'react'
import { Alert, Box, Button, Chip, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined'
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline'
import { CitationChips } from '../../components/answer/AnswerText'
import type {
  StudySelfGrade,
  TutorConfidence,
  TutorHint,
  TutorPracticeResult,
  TutorQuiz,
  TutorReveal,
  TutorWhyResult,
} from '../../../electron/types'
import { formatHms } from './bookmarks'

export const CONFIDENCE_LABEL: Record<TutorConfidence, string> = { low: 'Low', medium: 'Medium', high: 'High' }
export const GRADE_LABEL: Record<StudySelfGrade, string> = { missed: 'Missed', partial: 'Partly', got: 'Got it' }
const GRADE_COLOR: Record<StudySelfGrade, 'error' | 'warning' | 'success'> = { missed: 'error', partial: 'warning', got: 'success' }
const WHY_LABEL: Record<TutorWhyResult['verdict'], string> = { supported: 'Supported', partly: 'Partly supported', unsupported: 'Not in the transcript' }

/** "quiz me", "Quiz me on this", "quiz me please" — typed in Ask. Pure. */
export function isQuizRequest(text: string): boolean {
  return /^\s*quiz me\b/i.test(text ?? '')
}

type Phase = 'attempt' | 'confidence' | 'revealed'
type Mode = 'typed' | 'dontKnow' | 'justShow'

export interface TutorPanelProps {
  quiz: TutorQuiz
  videoTitle?: string
  sourceType?: 'local' | 'youtube'
  large?: boolean
  onSeek: (sec: number) => void
  onSelectCitation: (id: string) => void
  onPractice: (result: TutorPracticeResult) => void
  onClose: () => void
}

export function TutorPanel({ quiz, videoTitle, sourceType, large, onSeek, onSelectCitation, onPractice, onClose }: TutorPanelProps) {
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('attempt')
  const [mode, setMode] = useState<Mode>('typed')
  const [attempt, setAttempt] = useState('')
  const [confidence, setConfidence] = useState<TutorConfidence | null>(null)
  const [hints, setHints] = useState<TutorHint[]>([])
  const [reveal, setReveal] = useState<TutorReveal | null>(null)
  const [why, setWhy] = useState('')
  const [whyResult, setWhyResult] = useState<TutorWhyResult | null>(null)
  const [practice, setPractice] = useState<TutorPracticeResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [score, setScore] = useState<StudySelfGrade[]>([])

  const q = quiz.questions[index]
  if (!q) return null
  const api = window.lkv?.media

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const lock = (m: Mode) => {
    setMode(m)
    setPhase('confidence')
  }

  const nextHint = () =>
    run(async () => {
      if (!api?.tutorHint) return
      const h = await api.tutorHint({ questionId: q.id, level: hints.length + 1 })
      setHints((prev) => [...prev, h])
    })

  const doReveal = () =>
    run(async () => {
      if (!api?.tutorReveal || !confidence) return
      const r = await api.tutorReveal({
        questionId: q.id,
        attempt: mode === 'typed' ? attempt : undefined,
        dontKnow: mode === 'dontKnow',
        justShowMe: mode === 'justShow',
        confidence,
      })
      setReveal(r)
      setScore((prev) => [...prev, r.grade])
      setPhase('revealed')
    })

  const checkWhy = () =>
    run(async () => {
      if (!api?.tutorWhy || !why.trim()) return
      setWhyResult(await api.tutorWhy({ questionId: q.id, why }))
    })

  const doPractice = (makeCard: boolean) =>
    run(async () => {
      if (!api?.tutorPractice) return
      const r = await api.tutorPractice({ questionId: q.id, makeCard, videoTitle, sourceType })
      setPractice(r)
      onPractice(r)
    })

  const next = () => {
    setIndex((i) => i + 1)
    setPhase('attempt')
    setMode('typed')
    setAttempt('')
    setConfidence(null)
    setHints([])
    setReveal(null)
    setWhy('')
    setWhyResult(null)
    setPractice(null)
    setError(null)
  }

  const last = index + 1 >= quiz.questions.length
  const hintsLeft = hints.length < 3 && !hints.some((h) => h.last)
  const attemptLabel = mode === 'dontKnow' ? 'I don’t know' : mode === 'justShow' ? '(you asked to see the answer)' : attempt.trim()

  return (
    <Paper variant="outlined" data-testid="tutor-panel" sx={{ p: 1.25, borderColor: 'primary.main', display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <SchoolOutlinedIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          Exam tutor · question {index + 1} of {quiz.questions.length}
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          label={`${quiz.bookmarkId ? 'Bookmark' : 'Around'} ${formatHms(quiz.centerSec)}`}
          onClick={() => onSeek(quiz.windowStartSec)}
          aria-label={`Quiz window starts at ${formatHms(quiz.windowStartSec)}`}
        />
        <Button size="small" onClick={onClose}>
          End quiz
        </Button>
      </Stack>
      {quiz.notice && (
        <Typography variant="caption" color="text.secondary">
          {quiz.notice}
        </Typography>
      )}
      <Typography variant={large ? 'h6' : 'body1'} fontWeight={600} data-testid="tutor-question">
        {q.text}
      </Typography>
      {q.objective && (
        <Box>
          <Chip
            size="small"
            color="secondary"
            variant="outlined"
            data-testid="tutor-objective"
            label={`Objective ${q.objective.label}`}
            title={`From your note “${q.objective.title}”`}
            onClick={() => onSelectCitation(q.objective!.itemId)}
            sx={{ maxWidth: '100%' }}
          />
        </Box>
      )}

      {phase === 'attempt' && (
        <>
          <TextField
            size="small"
            multiline
            minRows={2}
            label="Your answer"
            placeholder="Answer from memory first"
            value={attempt}
            onChange={(e) => setAttempt(e.target.value)}
            inputProps={{ 'aria-label': 'Your answer', maxLength: 1000 }}
          />
          {hints.length > 0 && (
            <Stack spacing={0.5} data-testid="tutor-hints">
              {hints.map((h) => (
                <Alert key={h.level} severity="info" variant="outlined" sx={{ py: 0 }}>
                  <Typography variant="body2">
                    Hint {h.level}: {h.text}
                    {h.seekSec != null && (
                      <Button size="small" sx={{ ml: 1 }} startIcon={<PlayCircleOutlineIcon fontSize="small" />} onClick={() => onSeek(h.seekSec!)}>
                        Rewatch {formatHms(h.seekSec)}
                      </Button>
                    )}
                  </Typography>
                </Alert>
              ))}
            </Stack>
          )}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button size="small" variant="contained" disabled={busy || !attempt.trim()} onClick={() => lock('typed')}>
              Submit answer
            </Button>
            <Button size="small" variant="outlined" disabled={busy} onClick={() => lock('dontKnow')}>
              I don’t know
            </Button>
            <Button size="small" disabled={busy || !hintsLeft} onClick={() => void nextHint()}>
              {hintsLeft ? `Hint (${hints.length + 1} of 3)` : 'No more hints'}
            </Button>
            <Button size="small" color="inherit" disabled={busy} onClick={() => lock('justShow')}>
              Just show me
            </Button>
          </Stack>
        </>
      )}

      {phase !== 'attempt' && (
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }} data-testid="tutor-attempt">
          <Box component="span" sx={{ color: 'text.secondary' }}>
            Your answer:{' '}
          </Box>
          {attemptLabel}
        </Typography>
      )}

      {phase === 'confidence' && (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2">How sure are you?</Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={confidence}
            onChange={(_e, v: TutorConfidence | null) => setConfidence(v)}
            aria-label="Confidence"
          >
            {(['low', 'medium', 'high'] as TutorConfidence[]).map((c) => (
              <ToggleButton key={c} value={c} aria-label={CONFIDENCE_LABEL[c]}>
                {CONFIDENCE_LABEL[c]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Button size="small" variant="contained" disabled={busy || !confidence} onClick={() => void doReveal()}>
            Reveal answer
          </Button>
          {mode === 'typed' && (
            <Button size="small" disabled={busy} onClick={() => setPhase('attempt')}>
              Change my answer
            </Button>
          )}
        </Stack>
      )}

      {phase === 'revealed' && reveal && (
        <Box data-testid="tutor-reveal" sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip size="small" color={GRADE_COLOR[reveal.grade]} label={GRADE_LABEL[reveal.grade]} data-testid="tutor-grade" />
            <Typography variant="caption" color="text.secondary">
              {confidence ? `${CONFIDENCE_LABEL[confidence]} confidence` : ''}
            </Typography>
            <Button size="small" startIcon={<PlayCircleOutlineIcon fontSize="small" />} onClick={() => onSeek(reveal.rewatchSec)}>
              Rewatch {formatHms(reveal.rewatchSec)}
            </Button>
          </Stack>
          <Typography variant="body2">{reveal.feedback}</Typography>
          <Typography variant="body2" data-testid="tutor-answer">
            <strong>Answer:</strong> {reveal.answer}
          </Typography>
          {reveal.quote && (
            <Typography variant="body2" color="text.secondary" sx={{ borderLeft: 3, borderColor: 'divider', pl: 1 }}>
              “{reveal.quote}”
            </Typography>
          )}
          {reveal.citations.length > 0 && <CitationChips citations={reveal.citations} onSelectCitation={onSelectCitation} />}
          {reveal.notice && (
            <Typography variant="caption" color="text.secondary">
              {reveal.notice}
            </Typography>
          )}
          {reveal.examNote && (
            <Typography variant="caption" color="primary" data-testid="tutor-exam-note">
              {reveal.examNote}
            </Typography>
          )}

          {reveal.askWhy && (
            <Stack spacing={0.75} data-testid="tutor-why">
              <Typography variant="body2" fontWeight={600}>
                Why is that? One sentence.
              </Typography>
              {!whyResult ? (
                <Stack direction="row" spacing={1} alignItems="flex-start">
                  <TextField
                    size="small"
                    fullWidth
                    value={why}
                    onChange={(e) => setWhy(e.target.value)}
                    inputProps={{ 'aria-label': 'Why is that?', maxLength: 400 }}
                  />
                  <Button size="small" variant="outlined" disabled={busy || !why.trim()} onClick={() => void checkWhy()}>
                    Check
                  </Button>
                </Stack>
              ) : (
                <Stack spacing={0.5}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip
                      size="small"
                      label={WHY_LABEL[whyResult.verdict]}
                      color={whyResult.verdict === 'supported' ? 'success' : whyResult.verdict === 'partly' ? 'warning' : 'error'}
                      data-testid="tutor-why-verdict"
                    />
                    <Typography variant="body2">{whyResult.note}</Typography>
                  </Stack>
                  {whyResult.citations.length > 0 && <CitationChips citations={whyResult.citations} onSelectCitation={onSelectCitation} />}
                </Stack>
              )}
            </Stack>
          )}

          {reveal.offerPractice && (
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap data-testid="tutor-practice">
              <Typography variant="body2">Turn this into practice:</Typography>
              <Button size="small" variant="outlined" disabled={busy || !!practice} onClick={() => void doPractice(false)}>
                Bookmark as Confused
              </Button>
              <Button size="small" variant="outlined" disabled={busy || !!practice?.cardId} onClick={() => void doPractice(true)}>
                Make a Study card
              </Button>
              {practice && (
                <Typography variant="caption" color="text.secondary" data-testid="tutor-practice-status">
                  {practice.cardId
                    ? practice.cardCreated
                      ? `Study card made from a Confused bookmark at ${formatHms(practice.bookmark.positionSec)}.`
                      : `This moment already has a Study card (${formatHms(practice.bookmark.positionSec)}).`
                    : practice.bookmarkCreated
                      ? `Bookmarked ${formatHms(practice.bookmark.positionSec)} as Confused.`
                      : `Already bookmarked ${formatHms(practice.bookmark.positionSec)} as Confused.`}
                </Typography>
              )}
            </Stack>
          )}

          <Stack direction="row" spacing={1} alignItems="center">
            {last ? (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }} data-testid="tutor-score">
                  Done: {score.filter((g) => g === 'got').length} got it · {score.filter((g) => g === 'partial').length} partly ·{' '}
                  {score.filter((g) => g === 'missed').length} missed
                </Typography>
                <Button size="small" variant="contained" onClick={onClose}>
                  Finish
                </Button>
              </>
            ) : (
              <Button size="small" variant="contained" onClick={next}>
                Next question
              </Button>
            )}
          </Stack>
        </Box>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
    </Paper>
  )
}
