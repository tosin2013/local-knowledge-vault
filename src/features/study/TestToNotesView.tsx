import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import QuizIcon from '@mui/icons-material/Quiz'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import SaveIcon from '@mui/icons-material/Save'
import type { VaultPluginRenderProps } from '../../plugins/types'
import { ProjectSelect } from '../ProjectSelect'
import type { TestToNotesItem, TestToNotesSuggestion } from '../../../electron/types'
import { parseTestResults, summarizeAttempts } from '../../../electron/test-to-notes-parse'

const FORMAT_HINT = `Paste plain text or CSV. Examples:

1. What is the capital of France? ✓
Your answer: Paris

2. What is 2 + 2? ✗
Your answer: 5

Or CSV:
question,answer,correct
What is 2 + 2?,5,no
Capital of France?,Paris,yes`

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

export function TestToNotesView({ onClose }: VaultPluginRenderProps) {
  const [raw, setRaw] = useState('')
  const [items, setItems] = useState<TestToNotesItem[]>([])
  const [parsing, setParsing] = useState(false)
  const [parseOffline, setParseOffline] = useState(false)
  const [parseRateLimited, setParseRateLimited] = useState(false)
  const [parseRetryAfterMs, setParseRetryAfterMs] = useState<number | undefined>(undefined)
  const [parseError, setParseError] = useState<string | null>(null)
  const [parseTick, setParseTick] = useState(0)
  const [project, setProject] = useState('')
  const [suggestions, setSuggestions] = useState<TestToNotesSuggestion[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [savedSuggestions, setSavedSuggestions] = useState<Record<number, boolean>>({})
  const [savedCorrect, setSavedCorrect] = useState<Record<number, boolean>>({})

  const summary = useMemo(() => summarizeAttempts(items), [items])
  const correctItems = useMemo(() => items.filter((it) => it.correct), [items])
  const wrongItems = useMemo(() => items.filter((it) => !it.correct), [items])

  // Parse pasted results with the model (debounced). Falls back to the
  // deterministic parser when the AI path is unavailable or fails.
  useEffect(() => {
    const text = raw
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
        setParseOffline(!!res.offline)
        setParseRateLimited(!!res.rateLimited)
        setParseRetryAfterMs(res.retryAfterMs)
        setParseError(res.error ?? null)
      } catch (e) {
        setItems(parseTestResults(text))
        setParseOffline(true)
        setParseRateLimited(false)
        setParseError(e instanceof Error ? e.message : String(e))
      } finally {
        setParsing(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [raw, parseTick])

  const hasAnalyzeApi = !!window.lkv?.testToNotes?.analyze

  const suggestFixes = async () => {
    if (!hasAnalyzeApi) {
      setError('Test to notes IPC is unavailable — restart Vault after updating.')
      return
    }
    if (wrongItems.length === 0) {
      setStatus('No incorrect items to work on.')
      return
    }
    setAnalyzing(true)
    setError(null)
    setStatus(null)
    try {
      const result = await window.lkv.testToNotes.analyze({
        items: wrongItems,
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
      await window.lkv.items.create({
        title: suggestion.title,
        body: suggestion.body,
        kind: 'note',
        status: 'ai-draft',
        para: 'resources',
        summary: `Corrective note for: ${suggestion.question}`.slice(0, 200),
        project: project || null,
      })
      setSavedSuggestions((prev) => ({ ...prev, [index]: true }))
      setStatus('Saved as an AI draft note — review and confirm it from your notes.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const saveFlashCard = async (item: TestToNotesItem, index: number) => {
    if (!window.lkv?.items?.create) {
      setError('Saving notes is unavailable — restart Vault after updating.')
      return
    }
    setError(null)
    try {
      await window.lkv.items.create({
        title: item.question,
        body: `Q: ${item.question}\n\nA: ${item.answer}`,
        kind: 'note',
        status: 'ai-draft',
        para: 'resources',
        summary: `Practice-test flash-card: ${item.question}`.slice(0, 200),
        project: project || null,
      })
      setSavedCorrect((prev) => ({ ...prev, [index]: true }))
      setStatus('Saved a reinforcement flash-card.')
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, p: 1.5, gap: 1.5 }}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
        <QuizIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
          Test to notes
        </Typography>
        {onClose && (
          <Button size="small" onClick={onClose}>
            Back to Ask
          </Button>
        )}
      </Stack>

      <Typography variant="body2" color="text.secondary">
        Paste practice-test results in almost any format, split them into correct and incorrect, and
        turn each wrong answer into a grounded note you can review and save. Parsing uses your model;
        when it is offline Vault falls back to its built-in parser.
      </Typography>

      <ProjectSelect value={project} onChange={setProject} label="Project" />

      <TextField
        label="Paste practice-test results"
        placeholder={FORMAT_HINT}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        multiline
        minRows={6}
        maxRows={14}
        fullWidth
        inputProps={{ 'aria-label': 'Paste practice-test results' }}
      />

      <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap">
        <Typography variant="subtitle2" fontWeight={600}>
          {parsing
            ? 'Parsing…'
            : `${summary.total} items · ${summary.correct} correct · ${summary.wrong} wrong`}
        </Typography>
        {!hasAnalyzeApi && (
          <Typography variant="caption" color="warning.main">
            Test to notes IPC unavailable — restart Vault after updating.
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
          Parsed with the built-in parser; results may include extra lines.
        </Alert>
      )}
      {!parseRateLimited && (parseOffline || parseError) && (
        <Alert severity="warning">
          {parseError
            ? `AI parsing failed (${parseError}) — showing the built-in parser's result.`
            : 'AI offline — showing the built-in parser\u2019s result.'}
        </Alert>
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

      <Box sx={{ overflow: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Divider textAlign="left">
          <Typography variant="caption" color="text.secondary">
            Correct
          </Typography>
        </Divider>
        {correctItems.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No correct items yet.
          </Typography>
        ) : (
          correctItems.map((item, index) => (
            <Card key={`correct-${index}-${item.question}`} variant="outlined">
              <CardContent sx={{ pb: 1 }}>
                <Typography variant="body2" fontWeight={600}>
                  {item.question}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {item.answer ? `Your answer: ${item.answer}` : 'No answer recorded.'}
                </Typography>
              </CardContent>
              <CardActions sx={{ px: 2, pb: 1.5, pt: 0 }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<SaveIcon />}
                  disabled={savedCorrect[index]}
                  onClick={() => void saveFlashCard(item, index)}
                >
                  {savedCorrect[index] ? 'Flash-card saved' : 'Save flash-card'}
                </Button>
              </CardActions>
            </Card>
          ))
        )}

        <Divider textAlign="left">
          <Typography variant="caption" color="text.secondary">
            Incorrect
          </Typography>
        </Divider>
        {wrongItems.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No incorrect items yet.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {wrongItems.map((item, index) => (
              <Card key={`wrong-${index}-${item.question}`} variant="outlined">
                <CardContent sx={{ py: 1 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {item.question}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {item.answer ? `Your answer: ${item.answer}` : 'No answer recorded.'}
                  </Typography>
                </CardContent>
              </Card>
            ))}
            <Box>
              <Button
                variant="contained"
                size="small"
                disabled={analyzing || !hasAnalyzeApi}
                onClick={() => void suggestFixes()}
              >
                {analyzing ? 'Drafting…' : 'Suggest fixes'}
              </Button>
            </Box>
          </Stack>
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
