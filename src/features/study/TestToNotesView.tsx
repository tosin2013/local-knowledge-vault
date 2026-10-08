import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import QuizIcon from '@mui/icons-material/Quiz'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import SaveIcon from '@mui/icons-material/Save'
import FileOpenIcon from '@mui/icons-material/FileOpen'
import SchoolIcon from '@mui/icons-material/School'
import type { VaultPluginRenderProps } from '../../plugins/types'
import { ProjectSelect } from '../ProjectSelect'
import { useStudyProject, type StudyProjectProps } from './useStudyProject'
import type { PracticeTestImportResult, TestToNotesItem, TestToNotesSuggestion } from '../../../electron/types'
import { parseTestResults, resolveOption, summarizeAttempts } from '../../../electron/test-to-notes-parse'
import { guessTestName, importSummary, linkSummary, todayLocal } from './practiceTest'

const FORMAT_HINT = `Paste plain text, CSV or a copied results page. Examples:

1. What is the capital of France? ✓
Your answer: Paris

Question 2 of 10   Incorrect
Which command repairs protected Windows system files?
  A. chkdsk
  B. sfc /scannow   (Correct answer)
Your answer: A
Explanation: sfc /scannow replaces corrupted system files.

Q12: B (correct: D)`

function fieldText(...parts: Array<string | undefined>): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0)
    .join('\n\n')
}

function humanizeMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`
  return `${Math.round(ms / 60_000)} m`
}

/** The learner's answer as text: "A" → "A. Disable System Restore" when the options are known. */
function answerText(item: TestToNotesItem): string {
  const a = (item.answer ?? '').trim()
  if (!a) return ''
  const text = resolveOption(a, item.options)
  return text === a ? a : `${a}. ${text}`
}

export type TestToNotesViewProps = VaultPluginRenderProps & StudyProjectProps

/**
 * Import practice test (#265). Paste results (or open a PDF / TXT / CSV),
 * check the parse, then **Add to Study**: every missed question becomes a card
 * with the test's own question, answer and explanation, starting as Missed.
 * Items with only a number ask for their question text. "Also add the ones I
 * got right" adds correct items as low-priority cards. Suggest fixes still
 * drafts grounded corrective notes, and a saved draft is linked to its card.
 */
export function TestToNotesView({ onClose, project: projectProp, onProjectChange }: TestToNotesViewProps) {
  const [raw, setRaw] = useState('')
  const [items, setItems] = useState<TestToNotesItem[]>([])
  const [parsing, setParsing] = useState(false)
  const [parseOffline, setParseOffline] = useState(false)
  const [parseRateLimited, setParseRateLimited] = useState(false)
  const [parseRetryAfterMs, setParseRetryAfterMs] = useState<number | undefined>(undefined)
  const [parseError, setParseError] = useState<string | null>(null)
  const [parseTick, setParseTick] = useState(0)
  const [project, setProject] = useStudyProject(projectProp, onProjectChange)
  const [testName, setTestName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [testDate, setTestDate] = useState(todayLocal())
  const [includeCorrect, setIncludeCorrect] = useState(false)
  const [questionTexts, setQuestionTexts] = useState<Record<number, string>>({})
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState<PracticeTestImportResult | null>(null)
  const [suggestions, setSuggestions] = useState<TestToNotesSuggestion[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [fileNote, setFileNote] = useState<string | null>(null)
  const [savedSuggestions, setSavedSuggestions] = useState<Record<number, boolean>>({})

  const summary = useMemo(() => summarizeAttempts(items), [items])
  const indexed = useMemo(() => items.map((item, index) => ({ item, index })), [items])
  const correctItems = useMemo(() => indexed.filter(({ item }) => item.correct), [indexed])
  const wrongItems = useMemo(() => indexed.filter(({ item }) => !item.correct), [indexed])
  const needText = useMemo(
    () => indexed.filter(({ item, index }) => item.needsText && !(questionTexts[index] ?? '').trim()),
    [indexed, questionTexts],
  )

  // Suggest a test name from the paste until the learner types one.
  useEffect(() => {
    if (!nameTouched) setTestName(guessTestName(raw))
  }, [raw, nameTouched])

  // Parse pasted results with the model (debounced). Falls back to the
  // deterministic parser when the AI path is unavailable or fails.
  useEffect(() => {
    const text = raw
    setImported(null)
    if (!text.trim()) {
      setItems([])
      setParsing(false)
      setParseOffline(false)
      setParseRateLimited(false)
      setParseRetryAfterMs(undefined)
      setParseError(null)
      return
    }
    const parse = window.lkv?.testToNotes?.parse
    if (!parse) {
      setItems(parseTestResults(text))
      setParsing(false)
      setParseOffline(false)
      setParseRateLimited(false)
      setParseRetryAfterMs(undefined)
      setParseError(null)
      return
    }
    setParsing(true)
    const timer = setTimeout(async () => {
      try {
        const res = await parse({ text })
        setItems(res.items ?? [])
        setQuestionTexts({})
        setParseOffline(!!res.offline)
        setParseRateLimited(!!res.rateLimited)
        setParseRetryAfterMs(res.retryAfterMs)
        setParseError(res.error ?? null)
      } catch {
        setItems(parseTestResults(text))
        setParseOffline(true)
        setParseRateLimited(false)
        setParseError(null)
      } finally {
        setParsing(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [raw, parseTick])

  const hasAnalyzeApi = !!window.lkv?.testToNotes?.analyze
  const hasImportApi = !!window.lkv?.practiceTest?.import
  const hasFileApi = !!window.lkv?.practiceTest?.openFile

  const openFile = async () => {
    const open = window.lkv?.practiceTest?.openFile
    if (!open) return
    setError(null)
    try {
      const res = await open()
      if (res.canceled) return
      if (res.error || !res.text) {
        setError(res.error ?? 'Could not read that file.')
        return
      }
      setRaw(res.text)
      setFileNote(
        res.truncated
          ? `Opened ${res.name}. It was long, so only the first part was loaded.`
          : `Opened ${res.name}. Check the questions below before adding them.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const addToStudy = async () => {
    const importTest = window.lkv?.practiceTest?.import
    if (!importTest) {
      setError('Import practice test is unavailable — restart Vault after updating.')
      return
    }
    setImporting(true)
    setError(null)
    setStatus(null)
    try {
      const texts = Object.fromEntries(
        Object.entries(questionTexts).filter(([, v]) => v.trim().length > 0),
      ) as Record<number, string>
      const res = await importTest({
        project: project || null,
        name: testName.trim() || 'Practice test',
        date: testDate || null,
        items,
        includeCorrect,
        questionTexts: texts,
      })
      setImported(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  const suggestFixes = async () => {
    if (!hasAnalyzeApi) {
      setError('Reading practice tests is unavailable — restart Vault after updating.')
      return
    }
    const wrong = wrongItems.map(({ item }) => item).filter((it) => !it.needsText)
    if (wrong.length === 0) {
      setStatus('No incorrect items with question text to work on.')
      return
    }
    setAnalyzing(true)
    setError(null)
    setStatus(null)
    try {
      const result = await window.lkv.testToNotes.analyze({
        items: wrong,
        ...(project ? { filters: { project } } : {}),
      })
      setSuggestions(result)
      setSavedSuggestions({})
      setStatus(
        result.length === 0
          ? 'No drafts came back — try again or check your notes.'
          : `Drafted ${result.length} corrective note${result.length === 1 ? '' : 's'} for review.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAnalyzing(false)
    }
  }

  const saveSuggestion = async (suggestion: TestToNotesSuggestion, index: number) => {
    if (!window.lkv?.items?.create) {
      setError('Saving notes is unavailable — restart Vault after updating.')
      return
    }
    setError(null)
    try {
      const note = await window.lkv.items.create({
        title: suggestion.title,
        body: suggestion.body,
        kind: 'note',
        status: 'ai-draft',
        para: 'resources',
        summary: `Corrective note for: ${suggestion.question}`.slice(0, 200),
        project: project || null,
      })
      setSavedSuggestions((prev) => ({ ...prev, [index]: true }))
      // Link the draft to its practice-test card, if the test is already in Study.
      const match = wrongItems.find(({ item }) => item.question === suggestion.question)
      const cardId = match && imported ? imported.cardIds[match.index] : undefined
      if (cardId && note?.id && window.lkv?.practiceTest?.link) {
        await window.lkv.practiceTest.link(cardId, note.id)
        setStatus('Saved as an AI draft and linked to its Study card. Confirm it in your own words from your notes.')
      } else {
        setStatus('Saved as an AI draft note — review and confirm it from your notes.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const copySuggestion = async (suggestion: TestToNotesSuggestion) => {
    try {
      await navigator.clipboard.writeText(fieldText(suggestion.title, suggestion.body))
      setStatus('Copied the draft to the clipboard.')
    } catch {
      setStatus('Could not copy — select the text and copy it manually.')
    }
  }

  const anyOffline = suggestions.some((s) => s.offline)
  const anyRateLimited = suggestions.some((s) => s.rateLimited)

  const itemCard = ({ item, index }: { item: TestToNotesItem; index: number }) => (
    <Card key={`item-${index}`} variant="outlined" data-testid={`practice-item-${index}`}>
      <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
        {item.needsText ? (
          <TextField
            size="small"
            fullWidth
            label={`Question text for ${item.question}`}
            placeholder="Type or paste the question from the test"
            value={questionTexts[index] ?? ''}
            onChange={(e) => setQuestionTexts((prev) => ({ ...prev, [index]: e.target.value }))}
            sx={{ mb: 0.5 }}
          />
        ) : (
          <Typography variant="body2" fontWeight={600}>
            {item.question}
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary">
          {item.answer ? `Your answer: ${answerText(item)}` : 'No answer recorded.'}
          {item.correctAnswer && !item.correct ? ` · Correct: ${resolveOption(item.correctAnswer, item.options)}` : ''}
        </Typography>
        {item.explanation && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            {item.explanation}
          </Typography>
        )}
      </CardContent>
    </Card>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, p: 1.5, gap: 1.5, overflow: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
        <QuizIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
          Import practice test
        </Typography>
        {onClose && (
          <Button size="small" onClick={onClose}>
            Back to Ask
          </Button>
        )}
      </Stack>

      <Typography variant="body2" color="text.secondary">
        Paste your results or open a file. Each question you missed becomes a Study card with the test&apos;s own
        answer and explanation, first in your next session. Vault links it to your note that covers it, or drafts a
        short corrective note for you to confirm in your own words. Past exam papers belong here, not in your notes.
      </Typography>

      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <ProjectSelect value={project} onChange={setProject} label="Project" />
        <TextField
          size="small"
          label="Test name"
          value={testName}
          onChange={(e) => {
            setNameTouched(true)
            setTestName(e.target.value)
          }}
          placeholder="e.g. Core 2 practice exam #3"
          sx={{ minWidth: 240, flex: 1 }}
        />
        <TextField
          size="small"
          type="date"
          label="Date taken"
          value={testDate}
          onChange={(e) => setTestDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
      </Stack>

      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField
          label="Paste practice-test results"
          placeholder={FORMAT_HINT}
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value)
            setFileNote(null)
          }}
          multiline
          minRows={6}
          maxRows={14}
          fullWidth
          inputProps={{ 'aria-label': 'Paste practice-test results' }}
        />
      </Stack>
      {(hasFileApi || fileNote) && (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          {hasFileApi && (
            <Button size="small" variant="outlined" startIcon={<FileOpenIcon />} onClick={() => void openFile()}>
              Open file…
            </Button>
          )}
          <Typography variant="caption" color="text.secondary">
            {fileNote ?? 'PDF (text layer), TXT or CSV. An exam PDF and its answer key can be pasted one after the other.'}
          </Typography>
        </Stack>
      )}

      <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap">
        <Typography variant="subtitle2" fontWeight={600}>
          {parsing
            ? 'Parsing…'
            : `${summary.total} items · ${summary.correct} correct · ${summary.wrong} wrong`}
          {!parsing && needText.length > 0 ? ` · ${needText.length} need question text` : ''}
        </Typography>
        {!hasAnalyzeApi && (
          <Typography variant="caption" color="warning.main">
            Practice-test import is unavailable — restart Vault after updating.
          </Typography>
        )}
      </Stack>

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
      {parseRateLimited && (
        <Alert
          severity="warning"
          action={
            <Button size="small" color="inherit" onClick={() => setParseTick((t) => t + 1)}>
              Retry with AI
            </Button>
          }
        >
          {parseRetryAfterMs != null
            ? `Rate limited — try again in ${humanizeMs(parseRetryAfterMs)}. `
            : 'Rate limited — try again shortly. '}
          Parsed with the built-in parser; check the items below.
        </Alert>
      )}
      {!parseRateLimited && (parseOffline || parseError) && (
        <Alert severity="warning">
          {parseOffline
            ? 'AI offline — showing the built-in parser\u2019s result.'
            : `${parseError} Check the items below — this is showing the built-in parser\u2019s result.`}
        </Alert>
      )}

      {items.length > 0 && (
        <Card variant="outlined" sx={{ flexShrink: 0 }}>
          <CardContent sx={{ pb: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Button
                variant="contained"
                startIcon={<SchoolIcon />}
                disabled={importing || parsing || !hasImportApi}
                onClick={() => void addToStudy()}
              >
                {importing ? 'Adding…' : 'Add to Study'}
              </Button>
              <FormControlLabel
                control={<Checkbox size="small" checked={includeCorrect} onChange={(e) => setIncludeCorrect(e.target.checked)} />}
                label="Also add the ones I got right"
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Missed questions start as Missed and come first. The ones you got right are added as low-priority cards
              only if you tick the box.
            </Typography>
            {imported && (
              <Alert severity={imported.added > 0 || imported.alreadyAdded > 0 ? 'success' : 'info'} sx={{ mt: 1 }} data-testid="import-result">
                <Typography variant="body2" fontWeight={600}>
                  {importSummary(imported)}.
                </Typography>
                {linkSummary(imported) && <Typography variant="body2">{linkSummary(imported)}.</Typography>}
                {imported.needText.length > 0 && (
                  <Typography variant="body2">
                    Type the question text for the items marked below, then Add to Study again.
                  </Typography>
                )}
                <Typography variant="caption">
                  Saved as “{imported.name} · {imported.date}”{project ? ` in ${project}` : ''}. Start a session from
                  Study session.
                </Typography>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, flexShrink: 0 }}>
        <Divider textAlign="left">
          <Typography variant="caption" color="text.secondary">
            Missed ({wrongItems.length})
          </Typography>
        </Divider>
        {wrongItems.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No incorrect items yet.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {wrongItems.map(itemCard)}
            <Box>
              <Button
                variant="outlined"
                size="small"
                disabled={analyzing || !hasAnalyzeApi}
                onClick={() => void suggestFixes()}
              >
                {analyzing ? 'Drafting…' : 'Suggest fixes'}
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                Optional: drafts a grounded corrective note from your own notes for each missed question.
              </Typography>
            </Box>
          </Stack>
        )}

        <Divider textAlign="left">
          <Typography variant="caption" color="text.secondary">
            Got right ({correctItems.length})
          </Typography>
        </Divider>
        {correctItems.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No correct items yet.
          </Typography>
        ) : (
          <Stack spacing={1}>{correctItems.map(itemCard)}</Stack>
        )}

        {anyRateLimited && (
          <Alert severity="warning">
            Some drafts were rate limited — run Suggest fixes again to retry them.
          </Alert>
        )}
        {anyOffline && (
          <Alert severity="warning">
            AI offline — the drafts below are fallback copy. Start a local model or add a provider in
            Advanced, then run Suggest fixes again.
          </Alert>
        )}

        {suggestions.length > 0 && (
          <>
            <Divider textAlign="left">
              <Typography variant="caption" color="text.secondary">
                Suggested corrective notes
              </Typography>
            </Divider>
            {suggestions.map((suggestion, index) => (
              <Card key={`suggestion-${index}-${suggestion.question}`} variant="outlined">
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                    <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>
                      {suggestion.title}
                    </Typography>
                    {savedSuggestions[index] && <Chip size="small" color="success" label="Saved" />}
                  </Stack>
                  {suggestion.yourAnswer && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                      Your answer: {suggestion.yourAnswer}
                    </Typography>
                  )}
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {suggestion.body}
                  </Typography>
                  {suggestion.citations.length > 0 && (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 1 }}>
                      {suggestion.citations.map((c) => (
                        <Chip key={c.id} size="small" variant="outlined" label={c.title} />
                      ))}
                    </Stack>
                  )}
                </CardContent>
                <CardActions sx={{ px: 2, pb: 1.5, pt: 0, flexWrap: 'wrap', gap: 0.5 }}>
                  {!suggestion.offline && !suggestion.rateLimited && !suggestion.error && (
                    <>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<SaveIcon />}
                        disabled={savedSuggestions[index]}
                        onClick={() => void saveSuggestion(suggestion, index)}
                      >
                        Save as draft note
                      </Button>
                      <Button
                        size="small"
                        startIcon={<ContentCopyIcon />}
                        onClick={() => void copySuggestion(suggestion)}
                      >
                        Copy
                      </Button>
                    </>
                  )}
                </CardActions>
              </Card>
            ))}
          </>
        )}
      </Box>
    </Box>
  )
}
