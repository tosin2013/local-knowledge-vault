/**
 * Study guide / research notes while watching (#365): you write, Vault checks
 * and cites.
 *
 * Lives in the player column so it works in fullscreen. Checkpoints fall at
 * chapter boundaries (or every N minutes), pause gently and ask "In your own
 * words…"; `G` opens one any time. Vault checks the summary against that part
 * of the transcript (covered / rewatch for / not supported, each with a
 * timestamp) and the learner chooses what goes in. Vault drafts only when
 * asked, and a draft stays `ai-draft` until rewritten or summarised in the
 * learner's own words.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import EditNoteIcon from '@mui/icons-material/EditNote'
import { CitationChips } from '../../components/answer/AnswerText'
import type {
  GuideAddInput,
  GuideCardsResult,
  GuideEntry,
  GuideMode,
  GuideRelatedNote,
  GuideSummaryCheck,
  GuideTextCheck,
  MediaGuide,
} from '../../../electron/types'
import { formatHms } from './bookmarks'
import { CHECKPOINT_CHOICES, SNOOZE_SEC, checkpointState, isCheckpointShortcut, nextCheckpoint } from './guide'

type ResearchSection = Exclude<GuideAddInput['section'], 'term'>
const RESEARCH_SECTIONS: Array<{ value: ResearchSection; label: string; placeholder: string }> = [
  { value: 'claim', label: 'Claim', placeholder: 'What the speaker claims, in your words' },
  { value: 'evidence', label: 'Evidence', placeholder: 'The evidence they give' },
  { value: 'quote', label: 'Quote', placeholder: 'Copy the exact words from the transcript' },
  { value: 'take', label: 'My take', placeholder: 'What you think' },
  { value: 'question', label: 'Open question', placeholder: 'What you still want to know' },
]
const VERDICT_LABEL: Record<GuideTextCheck['verdict'], string> = {
  supported: 'Transcript supports this',
  partly: 'Partly supported',
  unsupported: 'Not supported',
  'not-found': 'Not in the transcript',
}
const VERDICT_COLOR: Record<GuideTextCheck['verdict'], 'success' | 'warning' | 'error' | 'default'> = {
  supported: 'success',
  partly: 'warning',
  unsupported: 'error',
  'not-found': 'default',
}
const SECTION_LABEL: Record<GuideEntry['section'], string> = {
  summary: 'Summary',
  gap: 'Rewatch for',
  term: 'Key term',
  claim: 'Claim',
  evidence: 'Evidence',
  quote: 'Quote',
  take: 'My take',
  question: 'Open question',
  connection: 'Connection',
}

interface Checkpoint {
  start: number
  end: number
  chapter: string | null
}

export interface GuidePanelProps {
  videoKey: string
  project: string
  videoTitle: string
  sourceType: 'local' | 'youtube'
  currentTime: number
  durationSec: number | null
  large?: boolean
  /** The player's time at the moment of use. */
  readTime: () => number
  onSeek: (sec: number) => void
  /** Pause the player (a checkpoint pauses gently). */
  onPause: () => void
  onSelectCitation: (id: string) => void
  onOpenNote?: (id: string) => void
}

function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

export function GuidePanel(props: GuidePanelProps) {
  const { videoKey, project, videoTitle, sourceType, currentTime, durationSec, large, readTime, onSeek, onPause, onSelectCitation, onOpenNote } = props
  const api = window.lkv?.media
  const [guides, setGuides] = useState<MediaGuide[]>([])
  const [mode, setMode] = useState<GuideMode>('study')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null)
  const [summary, setSummary] = useState('')
  const [check, setCheck] = useState<GuideSummaryCheck | null>(null)
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [term, setTerm] = useState('')
  const [definition, setDefinition] = useState('')
  const [rSection, setRSection] = useState<ResearchSection>('claim')
  const [rText, setRText] = useState('')
  const [related, setRelated] = useState<GuideRelatedNote[] | null>(null)
  const [cards, setCards] = useState<GuideCardsResult | null>(null)
  const [rewrite, setRewrite] = useState<Record<string, string>>({})
  const [ownLine, setOwnLine] = useState<Record<string, string>>({})
  const [jumpAnchor, setJumpAnchor] = useState(0)

  const guide = guides.find((g) => g.mode === mode) ?? null

  // Load this video's guides; a guide belongs to the video it was started on.
  useEffect(() => {
    let alive = true
    setGuides([])
    setCheckpoint(null)
    setCheck(null)
    setRelated(null)
    setCards(null)
    setJumpAnchor(0)
    if (!videoKey || !api?.guideList) return
    api
      .guideList(videoKey)
      .then((list) => {
        if (!alive) return
        setGuides(list)
        if (list.length && !list.some((g) => g.mode === 'study')) setMode(list[0].mode)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoKey])

  const put = (g: MediaGuide) => setGuides((prev) => [...prev.filter((x) => x.id !== g.id), g])

  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true)
    setError(null)
    try {
      return await fn()
    } catch (e) {
      setError(errorText(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  const anchor = guide ? Math.max(guide.lastCheckpointSec, jumpAnchor) : 0
  const next = useMemo(
    () =>
      guide
        ? nextCheckpoint({
            anchorSec: anchor,
            checkpointMin: guide.checkpointMin,
            checkpointsOff: guide.checkpointsOff,
            snoozedUntilSec: guide.snoozedUntilSec,
            chapters: guide.chapters,
            durationSec,
          })
        : null,
    [guide, anchor, durationSec],
  )

  const openCheckpoint = (end: number, chapter: string | null) => {
    if (!guide) return
    if (end < 5) {
      setInfo('Watch a little first — there’s nothing to sum up yet.')
      return
    }
    let start = anchor
    if (end - start < 5) start = Math.max(0, end - guide.checkpointMin * 60)
    setCheckpoint({ start, end, chapter })
    setSummary('')
    setCheck(null)
    setChosen(new Set())
    setInfo(null)
    onPause()
  }

  // Playback crossing a checkpoint opens it; a seek far past one just moves on.
  useEffect(() => {
    if (!guide || checkpoint || busy) return
    const state = checkpointState(currentTime, next)
    if (state === 'due' && next) openCheckpoint(next.sec, next.chapter)
    else if (state === 'jumped') setJumpAnchor(currentTime)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, next, guide?.id, checkpoint, busy])

  // `G` opens a checkpoint at the playhead — fullscreen too (window listener).
  const openRef = useRef(openCheckpoint)
  openRef.current = openCheckpoint
  const readRef = useRef(readTime)
  readRef.current = readTime
  useEffect(() => {
    if (!guide) return
    const onKey = (e: KeyboardEvent) => {
      if (!isCheckpointShortcut(e)) return
      e.preventDefault()
      openRef.current(readRef.current(), null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [guide?.id])

  if (!api?.guideStart) return null

  const start = async (m: GuideMode) => {
    const g = await run(() => api.guideStart({ videoKey, project, videoTitle, sourceType, mode: m }))
    if (g) {
      put(g)
      setMode(m)
      setInfo(`Started “${g.noteTitle}”. Watch, then write what you understood at each checkpoint — Vault checks it against the transcript.`)
    }
  }

  const settings = async (patch: { checkpointMin?: number; checkpointsOff?: boolean; snoozedUntilSec?: number | null; lastCheckpointSec?: number }) => {
    if (!guide) return
    const g = await run(() => api.guideSettings({ guideId: guide.id, ...patch }))
    if (g) put(g)
  }

  const runCheck = async () => {
    if (!guide || !checkpoint) return
    const res = await run(() => api.guideCheckSummary({ guideId: guide.id, startSec: checkpoint.start, endSec: checkpoint.end, text: summary }))
    if (res) {
      setCheck(res)
      setChosen(new Set(res.gaps.map((_, i) => i)))
    }
  }

  const saveCheckpoint = async (withCheck: boolean) => {
    if (!guide || !checkpoint) return
    const g = await run(() =>
      api.guideSaveCheckpoint({
        guideId: guide.id,
        startSec: checkpoint.start,
        endSec: checkpoint.end,
        text: summary,
        check: withCheck ? check : null,
        gapIndexes: withCheck ? [...chosen] : [],
      }),
    )
    if (g) {
      put(g)
      setCheckpoint(null)
      setCheck(null)
      setJumpAnchor(0)
      setInfo(`Saved ${formatHms(checkpoint.start)}–${formatHms(checkpoint.end)} to “${g.noteTitle}”.`)
    }
  }

  const skip = async () => {
    if (!checkpoint) return
    const end = checkpoint.end
    setCheckpoint(null)
    setCheck(null)
    await settings({ lastCheckpointSec: end })
  }

  const snooze = async () => {
    setCheckpoint(null)
    setCheck(null)
    await settings({ snoozedUntilSec: Math.floor(readTime()) + SNOOZE_SEC })
    setInfo(`Checkpoints snoozed for ${SNOOZE_SEC / 60} minutes.`)
  }

  const draft = async () => {
    if (!guide || !checkpoint) return
    const g = await run(() => api.guideDraft({ guideId: guide.id, startSec: checkpoint.start, endSec: checkpoint.end }))
    if (g) {
      put(g)
      setCheckpoint(null)
      setCheck(null)
      setJumpAnchor(0)
      setInfo('Vault drafted this part. It stays ai-draft until you rewrite it or add a line in your own words.')
    }
  }

  const confirm = async (e: GuideEntry, useLine: boolean) => {
    const g = await run(() =>
      api.guideConfirm(useLine ? { entryId: e.id, ownLine: ownLine[e.id] ?? '' } : { entryId: e.id, text: rewrite[e.id] ?? e.text }),
    )
    if (g) {
      put(g)
      setInfo('Confirmed — it’s your note now.')
    }
  }

  const add = async (input: Omit<GuideAddInput, 'guideId' | 'sec'>) => {
    if (!guide) return false
    const g = await run(() => api.guideAdd({ guideId: guide.id, sec: Math.floor(readTime()), ...input }))
    if (g) put(g)
    return !!g
  }

  const removeEntry = async (id: string) => {
    const g = await run(() => api.guideDeleteEntry(id))
    if (g) put(g)
  }

  const findRelated = async () => {
    if (!guide) return
    const list = await run(() => api.guideRelated(guide.id))
    if (list) setRelated(list)
  }

  const connect = async (itemId: string) => {
    if (!guide) return
    const g = await run(() => api.guideConnect({ guideId: guide.id, itemId }))
    if (g) {
      put(g)
      setRelated((prev) => (prev ? prev.filter((r) => r.itemId !== itemId) : prev))
    }
  }

  const makeCards = async () => {
    if (!guide) return
    const res = await run(() => api.guideCards(guide.id))
    if (res) {
      setCards(res)
      const g = await api.guideGet(guide.id).catch(() => null)
      if (g) put(g)
    }
  }

  const ts = (sec: number | null) =>
    sec == null ? null : (
      <Chip size="small" variant="outlined" label={formatHms(sec)} onClick={() => onSeek(sec)} aria-label={`Rewatch ${formatHms(sec)}`} />
    )

  /* ---- Not started ---- */
  if (!guide) {
    return (
      <Paper variant="outlined" sx={{ p: 1.25 }} data-testid="guide-panel">
        <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
          <EditNoteIcon fontSize="small" color="action" />
          <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 140 }}>
            Notes while watching
          </Typography>
          <Button size="small" variant="outlined" disabled={busy} onClick={() => void start('study')}>
            Start study guide
          </Button>
          <Button size="small" variant="outlined" disabled={busy} onClick={() => void start('research')}>
            Start research notes
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          You write; Vault checks what you write against the transcript and cites it.
        </Typography>
        {guides.length > 0 && (
          <Box sx={{ mt: 0.5 }}>
            <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setMode(v)}>
              {guides.map((g) => (
                <ToggleButton key={g.id} value={g.mode}>
                  {g.mode === 'research' ? 'Research notes' : 'Study guide'}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
      </Paper>
    )
  }

  const drafts = guide.entries.filter((e) => e.aiDraft && !e.confirmed)
  const visibleEntries = guide.entries.filter((e) => !(e.aiDraft && !e.confirmed))
  const other = guides.find((g) => g.mode !== mode)

  return (
    <Paper variant="outlined" sx={{ p: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }} data-testid="guide-panel">
      <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
        <EditNoteIcon fontSize="small" color="action" />
        <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 140 }} noWrap title={guide.noteTitle}>
          {guide.noteTitle}
        </Typography>
        {guide.hasUnconfirmedDraft && <Chip size="small" color="warning" label="ai-draft" data-testid="guide-ai-draft" />}
        {onOpenNote && guide.itemId && (
          <Button size="small" onClick={() => onOpenNote(guide.itemId as string)}>
            Open note
          </Button>
        )}
        <Button
          size="small"
          onClick={() => (other ? setMode(other.mode) : void start(mode === 'study' ? 'research' : 'study'))}
          disabled={busy}
        >
          {mode === 'study' ? (other ? 'Research notes' : 'Start research notes') : other ? 'Study guide' : 'Start study guide'}
        </Button>
      </Stack>

      {/* Checkpoint settings */}
      <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap" data-testid="guide-settings">
        <TextField
          select
          size="small"
          label="Checkpoints"
          value={guide.checkpointsOff ? 'off' : String(guide.checkpointMin)}
          onChange={(e) => void settings(e.target.value === 'off' ? { checkpointsOff: true } : { checkpointsOff: false, checkpointMin: Number(e.target.value) })}
          sx={{ minWidth: 170 }}
          disabled={busy}
        >
          {CHECKPOINT_CHOICES.map((n) => (
            <MenuItem key={n} value={String(n)}>
              {guide.chapters.length ? `At chapters (else ${n} min)` : `Every ${n} min`}
            </MenuItem>
          ))}
          <MenuItem value="off">Off</MenuItem>
        </TextField>
        <Button size="small" variant="outlined" onClick={() => openCheckpoint(readTime(), null)} disabled={busy || !!checkpoint}>
          Checkpoint now (G)
        </Button>
        {!guide.checkpointsOff && (
          <Button size="small" onClick={() => void snooze()} disabled={busy}>
            Snooze 5 min
          </Button>
        )}
        <Typography variant="caption" color="text.secondary" data-testid="guide-next">
          {guide.checkpointsOff
            ? 'Checkpoints are off — press G whenever you want one.'
            : next
              ? `Next checkpoint ${formatHms(next.sec)}${next.chapter ? ` · end of “${next.chapter}”` : ''}`
              : 'No more checkpoints in this video.'}
        </Typography>
      </Stack>

      {info && (
        <Alert severity="info" onClose={() => setInfo(null)} data-testid="guide-info">
          {info}
        </Alert>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError(null)} data-testid="guide-error">
          {error}
        </Alert>
      )}

      {/* Checkpoint */}
      {checkpoint && (
        <Paper variant="outlined" sx={{ p: 1.25, bgcolor: 'action.hover' }} data-testid="guide-checkpoint">
          <Typography variant="subtitle2">
            Checkpoint {formatHms(checkpoint.start)}–{formatHms(checkpoint.end)}
            {checkpoint.chapter ? ` · ${checkpoint.chapter}` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Paused. In your own words, what was this part about? Vault checks it against the transcript.
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={large ? 4 : 3}
            size="small"
            placeholder="In your own words…"
            value={summary}
            onChange={(e) => {
              setSummary(e.target.value)
              setCheck(null)
            }}
            inputProps={{ 'aria-label': 'Your summary' }}
            sx={{ mt: 1 }}
          />
          {!check && (
            <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1 }}>
              <Button size="small" variant="contained" disabled={busy || !summary.trim()} onClick={() => void runCheck()}>
                Check my summary
              </Button>
              <Button size="small" disabled={busy || !summary.trim()} onClick={() => void saveCheckpoint(false)}>
                Save without checking
              </Button>
              <Button size="small" disabled={busy} onClick={() => void draft()}>
                Draft it for me
              </Button>
              <Button size="small" disabled={busy} onClick={() => void skip()}>
                Skip
              </Button>
              <Button size="small" disabled={busy} onClick={() => void snooze()}>
                Snooze 5 min
              </Button>
            </Stack>
          )}
          {check && (
            <Box sx={{ mt: 1 }} data-testid="guide-check">
              {check.notice && (
                <Alert severity="info" sx={{ mb: 1 }}>
                  {check.notice}
                </Alert>
              )}
              {check.covered.length > 0 && (
                <>
                  <Typography variant="caption" fontWeight={600}>
                    You covered
                  </Typography>
                  {check.covered.map((c, i) => (
                    <Stack key={`c${i}`} direction="row" gap={1} alignItems="center" data-testid="guide-covered">
                      {ts(c.sec)}
                      <Typography variant="body2">{c.text}</Typography>
                    </Stack>
                  ))}
                </>
              )}
              {check.gaps.length > 0 && (
                <>
                  <Typography variant="caption" fontWeight={600} component="div" sx={{ mt: 0.5 }}>
                    You missed — rewatch for (tick what goes in your guide)
                  </Typography>
                  {check.gaps.map((g, i) => (
                    <Stack key={`g${i}`} direction="row" gap={0.5} alignItems="center" data-testid="guide-gap">
                      <Checkbox
                        size="small"
                        checked={chosen.has(i)}
                        onChange={(e) =>
                          setChosen((prev) => {
                            const s = new Set(prev)
                            if (e.target.checked) s.add(i)
                            else s.delete(i)
                            return s
                          })
                        }
                        inputProps={{ 'aria-label': `Keep: ${g.text}` }}
                      />
                      {ts(g.sec)}
                      <Typography variant="body2">{g.text}</Typography>
                    </Stack>
                  ))}
                </>
              )}
              {check.unsupported.length > 0 && (
                <>
                  <Typography variant="caption" fontWeight={600} component="div" sx={{ mt: 0.5 }}>
                    Not supported by this part of the transcript
                  </Typography>
                  {check.unsupported.map((u, i) => (
                    <Typography key={`u${i}`} variant="body2" data-testid="guide-unsupported">
                      “{u.claim}” — {u.note}
                    </Typography>
                  ))}
                </>
              )}
              {!check.covered.length && !check.gaps.length && !check.unsupported.length && !check.notice && (
                <Typography variant="body2">Nothing to flag.</Typography>
              )}
              <CitationChips citations={check.citations} onSelectCitation={onSelectCitation} />
              <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1 }}>
                <Button size="small" variant="contained" disabled={busy} onClick={() => void saveCheckpoint(true)}>
                  Save to guide
                </Button>
                <Button size="small" disabled={busy} onClick={() => setCheck(null)}>
                  Edit summary
                </Button>
                <Button size="small" disabled={busy} onClick={() => void skip()}>
                  Skip
                </Button>
              </Stack>
            </Box>
          )}
        </Paper>
      )}

      {/* ai-drafts waiting for the learner */}
      {drafts.map((e) => (
        <Paper key={e.id} variant="outlined" sx={{ p: 1.25, borderColor: 'warning.main' }} data-testid="guide-draft">
          <Stack direction="row" gap={1} alignItems="center">
            {ts(e.startSec)}
            <Typography variant="caption" color="warning.main" fontWeight={600}>
              ai-draft — rewrite to confirm
            </Typography>
          </Stack>
          <TextField
            fullWidth
            multiline
            size="small"
            value={rewrite[e.id] ?? e.text}
            onChange={(ev) => setRewrite((p) => ({ ...p, [e.id]: ev.target.value }))}
            inputProps={{ 'aria-label': 'Rewrite the draft' }}
            sx={{ mt: 1 }}
          />
          <Stack direction="row" gap={1} sx={{ mt: 1 }} alignItems="center" flexWrap="wrap">
            <Button size="small" variant="outlined" disabled={busy} onClick={() => void confirm(e, false)}>
              Confirm rewrite
            </Button>
            <Typography variant="caption" color="text.secondary">
              or
            </Typography>
            <TextField
              size="small"
              placeholder="One line in your own words"
              value={ownLine[e.id] ?? ''}
              onChange={(ev) => setOwnLine((p) => ({ ...p, [e.id]: ev.target.value }))}
              inputProps={{ 'aria-label': 'One line in your own words' }}
              sx={{ flex: 1, minWidth: 180 }}
            />
            <Button size="small" disabled={busy || !(ownLine[e.id] ?? '').trim()} onClick={() => void confirm(e, true)}>
              Confirm with my line
            </Button>
            <Button size="small" color="inherit" disabled={busy} onClick={() => void removeEntry(e.id)}>
              Discard
            </Button>
          </Stack>
        </Paper>
      ))}

      {/* Key terms (study) / research entries */}
      {mode === 'study' ? (
        <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center" data-testid="guide-term-form">
          <TextField size="small" label="Key term" value={term} onChange={(e) => setTerm(e.target.value)} sx={{ width: 150 }} />
          <TextField
            size="small"
            label="Definition in your own words"
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
            sx={{ flex: 1, minWidth: 180 }}
          />
          <Button
            size="small"
            variant="outlined"
            disabled={busy || !term.trim() || !definition.trim()}
            onClick={async () => {
              if (await add({ section: 'term', term, text: definition })) {
                setTerm('')
                setDefinition('')
              }
            }}
          >
            Check &amp; add
          </Button>
        </Stack>
      ) : (
        <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center" data-testid="guide-research-form">
          <TextField select size="small" label="Add" value={rSection} onChange={(e) => setRSection(e.target.value as ResearchSection)} sx={{ width: 150 }}>
            {RESEARCH_SECTIONS.map((s) => (
              <MenuItem key={s.value} value={s.value}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            placeholder={RESEARCH_SECTIONS.find((s) => s.value === rSection)?.placeholder}
            value={rText}
            onChange={(e) => setRText(e.target.value)}
            inputProps={{ 'aria-label': 'Research entry' }}
            sx={{ flex: 1, minWidth: 180 }}
          />
          <Button
            size="small"
            variant="outlined"
            disabled={busy || !rText.trim()}
            onClick={async () => {
              if (await add({ section: rSection, text: rText })) setRText('')
            }}
          >
            Add at {formatHms(currentTime)}
          </Button>
          {error && /claim instead/.test(error) && rSection === 'quote' && (
            <Button size="small" onClick={() => setRSection('claim')}>
              Add as a claim
            </Button>
          )}
        </Stack>
      )}

      {/* What's in the guide */}
      {visibleEntries.length > 0 && (
        <Box data-testid="guide-entries">
          <Divider sx={{ mb: 0.5 }} />
          {visibleEntries.map((e) => {
            const c = e.check && 'verdict' in e.check ? (e.check as GuideTextCheck) : null
            return (
              <Stack key={e.id} direction="row" gap={1} alignItems="flex-start" sx={{ py: 0.25 }} data-testid="guide-entry">
                <Box sx={{ minWidth: 72 }}>{ts(e.startSec)}</Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">
                    {SECTION_LABEL[e.section]}
                    {e.term ? ` · ${e.term}` : ''}
                    {e.aiDraft ? ' · confirmed draft' : ''}
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {e.section === 'quote' ? `“${e.text}”` : e.text}
                  </Typography>
                  {c && (
                    <Stack direction="row" gap={0.5} alignItems="center" flexWrap="wrap">
                      <Chip size="small" color={VERDICT_COLOR[c.verdict]} label={VERDICT_LABEL[c.verdict]} data-testid="guide-verdict" />
                      <Typography variant="caption" color="text.secondary">
                        {c.note}
                      </Typography>
                      <CitationChips citations={c.citations} onSelectCitation={onSelectCitation} />
                    </Stack>
                  )}
                </Box>
                <Button size="small" color="inherit" disabled={busy} onClick={() => void removeEntry(e.id)} aria-label={`Remove ${SECTION_LABEL[e.section]}`}>
                  Remove
                </Button>
              </Stack>
            )
          })}
        </Box>
      )}

      {/* Connections (research) */}
      {mode === 'research' && (
        <Box data-testid="guide-connections">
          <Button size="small" disabled={busy} onClick={() => void findRelated()}>
            Find related notes in my vault
          </Button>
          {related && related.length === 0 && (
            <Typography variant="caption" color="text.secondary" component="div">
              No related notes found yet — write a few entries first.
            </Typography>
          )}
          {related?.map((r) => (
            <Stack key={r.itemId} direction="row" gap={1} alignItems="center" data-testid="guide-related">
              <Typography variant="body2" sx={{ flex: 1 }} noWrap title={r.snippet}>
                {r.title}
              </Typography>
              <Button size="small" onClick={() => void connect(r.itemId)}>
                Link
              </Button>
            </Stack>
          ))}
        </Box>
      )}

      {/* Review these */}
      {guide.review.length > 0 && (
        <Box data-testid="guide-review">
          <Typography variant="caption" fontWeight={600}>
            Review these
          </Typography>
          {guide.review.map((r) => (
            <Stack key={`${r.kind}-${r.refId}`} direction="row" gap={1} alignItems="center">
              {ts(r.sec)}
              <Typography variant="body2" noWrap title={r.label} sx={{ flex: 1, minWidth: 0 }}>
                {r.kind === 'tutor-miss' ? `Exam tutor${r.confidentWrong ? ' (confident but wrong)' : ' miss'}: ${r.label}` : r.label}
              </Typography>
              {r.tag && <Chip size="small" label={r.tag} color={r.tag === 'Confused' ? 'warning' : 'default'} />}
            </Stack>
          ))}
        </Box>
      )}

      <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
        <Button size="small" variant="outlined" disabled={busy} onClick={() => void makeCards()}>
          Make Study cards from key terms &amp; gaps
        </Button>
        {cards && (
          <Typography variant="caption" data-testid="guide-cards">
            {cards.created > 0 ? `Made ${cards.created} card${cards.created === 1 ? '' : 's'}` : 'No new cards'}
            {cards.existing > 0 ? ` (${cards.existing} already made)` : ''}. {cards.reviewNote}
          </Typography>
        )}
      </Stack>
    </Paper>
  )
}
