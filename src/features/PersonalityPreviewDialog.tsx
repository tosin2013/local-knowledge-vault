import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import type { PersonalityPreviewResult } from '../../electron/types'
import { AnswerText, CitationChips } from '../components/answer/AnswerText'

export interface PersonalityPreviewDialogProps {
  open: boolean
  onClose: () => void
  /** Draft instructions under test. */
  body: string
  /** Draft name, shown in the title. */
  name: string
}

const DEFAULT_QUESTION = 'What are the key points in my notes?'

/** Preview a draft personality against the user's own notes (#164). */
export function PersonalityPreviewDialog({
  open,
  onClose,
  body,
  name,
}: PersonalityPreviewDialogProps) {
  const [question, setQuestion] = useState(DEFAULT_QUESTION)
  const [compare, setCompare] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PersonalityPreviewResult | null>(null)

  // Fresh dialog each time it opens, so a stale answer never looks current.
  useEffect(() => {
    if (open) {
      setResult(null)
      setBusy(false)
    }
  }, [open])

  const run = async () => {
    const q = question.trim()
    if (!q || !window.lkv?.prompts) return
    setBusy(true)
    try {
      const res = await window.lkv.prompts.preview({ question: q, body, compare })
      setResult(res)
    } catch (error) {
      setResult({ answer: '', citations: [], error: String(error) })
    } finally {
      setBusy(false)
    }
  }

  const answerBlock = (
    title: string,
    text: string | undefined,
    citations: PersonalityPreviewResult['citations'] | undefined,
    offline?: boolean,
  ) => (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3 }}>
      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
        {title}
      </Typography>
      {offline && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          No model answered — showing search hits only.
        </Alert>
      )}
      {text ? (
        <AnswerText text={text} citations={citations ?? []} />
      ) : (
        <Typography variant="body2" color="text.secondary">
          (no answer)
        </Typography>
      )}
      <CitationChips citations={(citations ?? []).map((c) => ({ ...c, title: c.title || c.id }))} />
    </Paper>
  )

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>Preview{name.trim() ? `: ${name.trim()}` : ''}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Ask a real question against your own notes. This does not save anything, and the answer
            still comes from your notes with the same citation rules.
          </Typography>
          <TextField
            fullWidth
            size="small"
            label="Sample question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) {
                e.preventDefault()
                void run()
              }
            }}
            autoFocus
          />
          <FormControlLabel
            control={
              <Switch checked={compare} onChange={(e) => setCompare(e.target.checked)} />
            }
            label="Compare with the default (no personality)"
          />
          {result?.error && <Alert severity="error">{result.error}</Alert>}
          {busy && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                Answering from your notes…
              </Typography>
            </Box>
          )}
          {result && !busy && !result.error && (
            <Stack spacing={1.5}>
              {answerBlock('This personality', result.answer, result.citations, result.offline)}
              {compare &&
                answerBlock(
                  'Default (no personality)',
                  result.defaultAnswer,
                  result.defaultCitations,
                  result.defaultOffline,
                )}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Close
        </Button>
        <Button
          variant="contained"
          onClick={() => void run()}
          disabled={busy || !question.trim() || !window.lkv?.prompts}
        >
          {result ? 'Run again' : 'Run preview'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
