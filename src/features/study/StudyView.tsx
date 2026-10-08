import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Slider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import SchoolIcon from '@mui/icons-material/School'
import SaveIcon from '@mui/icons-material/Save'
import type { VaultPluginRenderProps } from '../../plugins/types'
import { AnswerText, CitationChips } from '../../components/answer/AnswerText'
import { ProjectSelect } from '../ProjectSelect'
import { useStudyProject, type StudyProjectProps } from './useStudyProject'
import type {
  AskGroundedResult,
  StudyCalibration,
  StudySelfGrade,
} from '../../../electron/types'

const GRADES: Array<{ value: StudySelfGrade; label: string }> = [
  { value: 'missed', label: 'Missed' },
  { value: 'partial', label: 'Partial' },
  { value: 'got', label: 'Got it' },
]

function pct(v: number): string {
  return `${Math.round((v || 0) * 100)}%`
}

function signedPts(v: number): string {
  const pts = Math.round((v || 0) * 100)
  return `${pts > 0 ? '+' : ''}${pts} pts`
}

/**
 * Study mode (#215) — recall before reveal.
 *
 * Step 1 asks a question and quietly fetches the grounded answer. Before the
 * learner reveals, only the question, their recall, confidence and the reveal
 * controls are on screen; the answer and citations are not rendered at all
 * until `revealed` flips. After reveal they self-grade and can save the attempt
 * for the calibration strip. Every Vault-specific learning effect is a
 * hypothesis; the pilot in #218 measures it.
 */
export type StudyViewProps = VaultPluginRenderProps & StudyProjectProps

export function StudyView({ onClose, onOpenNote, project: projectProp, onProjectChange }: StudyViewProps) {
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState<string | null>(null)
  const [pending, setPending] = useState<AskGroundedResult | null>(null)
  const [asking, setAsking] = useState(false)
  const [revealed, setRevealed] = useState(false)

  const [recall, setRecall] = useState('')
  const [confidence, setConfidence] = useState(50)
  const [dontKnow, setDontKnow] = useState(false)

  const [selfGrade, setSelfGrade] = useState<StudySelfGrade | null>(null)
  const [selfExplanation, setSelfExplanation] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [calibration, setCalibration] = useState<StudyCalibration | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [project, setProject] = useStudyProject(projectProp, onProjectChange)
  const [sampleQuestions, setSampleQuestions] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)

  const refreshCalibration = useCallback(async () => {
    if (!window.lkv?.study?.calibration) return
    try {
      setCalibration(await window.lkv.study.calibration())
    } catch {
      /* the strip is optional; a failure should not block studying */
    }
  }, [])

  useEffect(() => {
    void refreshCalibration()
  }, [refreshCalibration])

  const getAnswer = async (qOverride?: string) => {
    const q = (qOverride ?? question).trim()
    if (!q) {
      setError('Type a question first.')
      return
    }
    if (!window.lkv?.ask?.grounded) {
      setError('Ask is unavailable — restart Vault after updating.')
      return
    }
    setAsking(true)
    setError(null)
    setStatus(null)
    try {
      const result = await window.lkv.ask.grounded({
        question: q,
        ...(project ? { filters: { project } } : {}),
      })
      // Store the answer but do NOT reveal it until the learner asks to.
      setAsked(q)
      setPending(result)
      setRevealed(false)
      setRecall('')
      setConfidence(50)
      setDontKnow(false)
      setSelfGrade(null)
      setSelfExplanation('')
      setSaved(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAsking(false)
    }
  }

  const generateQuestions = async () => {
    if (!window.lkv?.study?.questions) {
      setError('Sample questions are unavailable — restart Vault after updating.')
      return
    }
    setGenerating(true)
    setError(null)
    setStatus(null)
    try {
      const result = await window.lkv.study.questions({ project: project || undefined, count: 5 })
      setSampleQuestions(result.questions ?? [])
      if (!result.questions?.length) {
        setStatus('No notes found in this project to draw questions from.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
    }
  }

  const studyQuestion = (q: string) => {
    setQuestion(q)
    void getAnswer(q)
  }

  const canReveal = !!pending && (dontKnow || recall.trim().length > 0)

  const reveal = () => {
    if (!canReveal) return
    setRevealed(true)
  }

  const saveAttempt = async () => {
    if (!pending || !asked || !selfGrade || !window.lkv?.study?.record) {
      setError('Saving attempts is unavailable — restart Vault after updating.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await window.lkv.study.record({
        question: asked,
        attempt: dontKnow ? 'I don\'t know' : recall.trim(),
        confidence,
        selfGrade,
        selfExplanation: selfExplanation.trim() || null,
        citedIds: pending.citations.map((c) => c.id),
        answer: pending.answer,
      })
      setSaved(true)
      setStatus('Attempt saved — your calibration strip has been updated.')
      await refreshCalibration()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const startOver = () => {
    setQuestion('')
    setAsked(null)
    setPending(null)
    setRevealed(false)
    setRecall('')
    setConfidence(50)
    setDontKnow(false)
    setSelfGrade(null)
    setSelfExplanation('')
    setSaved(false)
    setStatus(null)
    setError(null)
  }

  /** Feedback is rendered only once `revealed` is true. */
  const feedback = revealed && pending

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, p: 1.5, gap: 1.5 }}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
        <SchoolIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
          Study
        </Typography>
        {onClose && (
          <Button size="small" onClick={onClose}>
            Back to Ask
          </Button>
        )}
      </Stack>

      <Typography variant="body2" color="text.secondary">
        Answer from memory first, then reveal the grounded answer from your notes as feedback. Every
        Vault-specific learning effect is a hypothesis — the pilot in #218 measures it.
      </Typography>

      {calibration && (
        <Card variant="outlined" data-testid="study-calibration">
          <CardContent sx={{ py: 1.5 }}>
            <Typography variant="subtitle2" fontWeight={600}>
              {`${calibration.count} attempts · mean confidence ${pct(calibration.meanConfidence)} vs mean self-graded accuracy ${pct(calibration.meanScore)} · bias ${signedPts(calibration.bias)} · Brier ${pct(calibration.brier)}`}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              A bias above 0 means overconfidence (you felt more sure than you were); below 0 means
              underconfidence. Calibration is a hypothesis Vault may help — #218 measures it.
            </Typography>
          </CardContent>
        </Card>
      )}

      <ProjectSelect
        value={project}
        onChange={(p) => {
          setProject(p)
          setSampleQuestions([])
        }}
        label="Project"
      />

      <TextField
        label="Question"
        placeholder="What do you want to test yourself on?"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        fullWidth
        size="small"
        inputProps={{ 'aria-label': 'Question' }}
      />
      <Box>
        <Button
          variant="contained"
          size="small"
          disabled={asking || !question.trim()}
          onClick={() => void getAnswer()}
        >
          {asking ? 'Getting answer…' : 'Get answer from my notes'}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={generating}
          onClick={() => void generateQuestions()}
          sx={{ ml: 1 }}
        >
          {generating ? 'Generating…' : 'Get sample questions'}
        </Button>
      </Box>

      {sampleQuestions.length > 0 && (
        <Stack spacing={0.5} data-testid="study-sample-questions">
          <Typography variant="caption" color="text.secondary">
            Sample questions from this project — pick one to study:
          </Typography>
          {sampleQuestions.map((q) => (
            <Button
              key={q}
              size="small"
              variant="outlined"
              sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
              onClick={() => studyQuestion(q)}
            >
              {q}
            </Button>
          ))}
        </Stack>
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

      {pending && !feedback && (
        <Card variant="outlined" data-testid="study-recall" sx={{ flexShrink: 0 }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
              {asked}
            </Typography>
            <TextField
              label="Your recall"
              placeholder="Say it from memory before you look"
              value={recall}
              onChange={(e) => setRecall(e.target.value)}
              multiline
              minRows={3}
              maxRows={8}
              fullWidth
              disabled={dontKnow}
              inputProps={{ 'aria-label': 'Your recall' }}
            />
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary">
                {`How confident are you? ${confidence}%`}
              </Typography>
              <Slider
                value={confidence}
                onChange={(_e, v) => setConfidence(Array.isArray(v) ? v[0] : v)}
                min={0}
                max={100}
                size="small"
                disabled={dontKnow}
                aria-label="Confidence"
              />
            </Box>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1, flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant={dontKnow ? 'contained' : 'outlined'}
                disabled={dontKnow}
                onClick={() => {
                  setDontKnow(true)
                  // A failed retrieval is a near-zero-confidence attempt; recording
                  // the slider's default here would inflate mean confidence (#215).
                  setConfidence(0)
                }}
              >
                I don&apos;t know
              </Button>
              <Button variant="contained" size="small" disabled={!canReveal} onClick={reveal}>
                Reveal answer
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {feedback && (
        <Stack spacing={1.5}>
          <Card variant="outlined" sx={{ flexShrink: 0 }}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Your recall
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 1.5 }}>
                {dontKnow ? 'I don\u2019t know' : recall.trim() || '(empty)'}
              </Typography>
              <Divider sx={{ mb: 1.5 }} />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Answer from your notes (feedback)
              </Typography>
              <AnswerText text={pending.answer} citations={pending.citations} onSelectCitation={onOpenNote} />
              <CitationChips citations={pending.citations} onSelectCitation={onOpenNote} />
              {pending.offline && (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  AI offline — showing fallback copy. Start a local model or add a provider in
                  Advanced, then try again. You can still save this attempt.
                </Alert>
              )}
            </CardContent>
          </Card>

          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              How did you do?
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={selfGrade}
              onChange={(_e, v: StudySelfGrade | null) => setSelfGrade(v)}
              aria-label="Self-grade"
            >
              {GRADES.map((g) => (
                <ToggleButton key={g.value} value={g.value} aria-label={g.label}>
                  {g.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>

          <TextField
            label="Explain it in your own words"
            value={selfExplanation}
            onChange={(e) => setSelfExplanation(e.target.value)}
            fullWidth
            size="small"
            inputProps={{ 'aria-label': 'Explain it in your own words' }}
          />

          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              size="small"
              startIcon={<SaveIcon />}
              disabled={saving || saved || !selfGrade}
              onClick={() => void saveAttempt()}
            >
              {saved ? 'Attempt saved' : 'Save attempt'}
            </Button>
            <Button size="small" variant="outlined" onClick={startOver}>
              New question
            </Button>
          </Stack>
        </Stack>
      )}
    </Box>
  )
}
