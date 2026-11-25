import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControlLabel,
  LinearProgress,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import MicIcon from '@mui/icons-material/Mic'
import StopIcon from '@mui/icons-material/Stop'
import QuizIcon from '@mui/icons-material/Quiz'
import SchoolIcon from '@mui/icons-material/School'
import ContentPasteIcon from '@mui/icons-material/ContentPaste'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import type { Citation, ReviewGrade, ReviewQueueItem } from '../../../electron/types'
import { ProjectSelect } from '../ProjectSelect'
import { AnswerText } from '../../components/answer/AnswerText'
import { parseSpokenCommand } from './speech'
import { isMultipleChoice, questionSpeech, quizInput, startCard, type QuizCardState } from './talkQuiz'
import { studyHint } from './speech'
import {
  conceptSpeech,
  current as teachConcept,
  exampleSpeech,
  goTo,
  isDone,
  mark,
  parseTeachCommand,
  startTeach,
  summarize,
  type TeachState,
  type TeachSummary,
} from './teachFlow'
import { PasteToLearnDialog } from './PasteToLearnDialog'
import { useTalkLoop } from './useTalkLoop'

export interface TalkViewProps {
  project: string
  onProjectChange: (project: string) => void
  onOpenNote?: (id: string) => void
  /** "Teach me this" on a note (#418): start a lesson on it. */
  teachNoteId?: string | null
  /** Called once the lesson for `teachNoteId` has started. */
  onTeachStarted?: () => void
}

interface Line {
  id: number
  role: 'you' | 'vault'
  text: string
  citations?: Citation[]
}

const QUIZ_CARDS = 5
const TEACH_WORDS = /^(teach me( this| these notes)?|teach)$/i
const QUIZ_WORDS = /\b(quiz me|test me|ask me (a|some) questions?)\b/i

function parseCitations(json: string | null): Citation[] {
  if (!json) return []
  try {
    const v = JSON.parse(json) as Citation[]
    return Array.isArray(v) ? v.filter((c) => c && typeof c.id === 'string') : []
  } catch {
    return []
  }
}

/**
 * Talk it through (#413): a spoken back-and-forth about your notes. Each turn
 * goes through the grounded Ask chat (same citations, same "I couldn't find that
 * in your notes", same session memory) with a short spoken reply style. One
 * press starts a hands-free loop: listen, end the turn on a pause, transcribe,
 * answer, speak sentence by sentence, listen again. Talking or pressing Stop
 * interrupts Vault. "Quiz me" runs Study cards inside the conversation, and
 * the grades feed spaced review.
 */
export function TalkView({ project, onProjectChange, onOpenNote, teachNoteId, onTeachStarted }: TalkViewProps) {
  const talk = useTalkLoop()
  const {
    voice,
    mic,
    busy,
    setBusy,
    running,
    notice,
    setNotice,
    stopSpeaking,
    speak,
    start,
    stop,
    canHear,
    status,
  } = talk
  const [lines, setLines] = useState<Line[]>([])
  const [handsFree, setHandsFree] = useState(true)
  const [typed, setTyped] = useState('')
  const [quiz, setQuiz] = useState<QuizCardState | null>(null)
  const teachRef = useRef<TeachState | null>(null)
  const [teach, setTeach] = useState<TeachState | null>(null)
  const [lesson, setLesson] = useState<TeachSummary | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const tallyRef = useRef<Record<ReviewGrade, number>>({ again: 0, hard: 0, good: 0, easy: 0 })
  const sessionRef = useRef<string | null>(null)
  const quizRef = useRef<{ sessionId: string; cards: ReviewQueueItem[]; index: number } | null>(null)
  const quizState = useRef<QuizCardState | null>(null)
  const nextId = useRef(1)

  // A new project starts a new conversation.
  useEffect(() => {
    sessionRef.current = null
    quizRef.current = null
    quizState.current = null
    setQuiz(null)
    teachRef.current = null
    setTeach(null)
    setLesson(null)
    setLines([])
  }, [project])

  const add = (role: Line['role'], text: string, citations?: Citation[]) =>
    setLines((prev) => [...prev, { id: nextId.current++, role, text, citations }])

  /** Show and (when spoken replies are on) say a line; resolves when the speech ends. */
  const say = useCallback((text: string, citations?: Citation[], rate = 1): Promise<void> => {
    add('vault', text, citations)
    return speak(text, rate)
  }, [speak])

  const askCard = useCallback(
    async (): Promise<void> => {
      const qz = quizRef.current
      const get = window.lkv?.study?.cardQuestion
      if (!qz || !get) return
      while (qz.index < qz.cards.length) {
        const q = await get(qz.cards[qz.index].card_id)
        if (!q.skipped) {
          const st = startCard(q)
          quizState.current = st
          setQuiz(st)
          void say(questionSpeech(q))
          return
        }
        qz.index++
      }
      quizRef.current = null
      quizState.current = null
      setQuiz(null)
      const t = tallyRef.current
      void say(
        `That’s the end of this round: ${t.good + t.easy} got it, ${t.hard} partly, ${t.again} missed. Ask me about anything in your notes, or say quiz me for another round.`
      )
    },
    [say]
  )

  const startQuiz = useCallback(async () => {
    const start = window.lkv?.study?.startSession
    if (!start) {
      void say('Study sessions are unavailable. Restart Vault after updating.')
      return
    }
    tallyRef.current = { again: 0, hard: 0, good: 0, easy: 0 }
    const res = await start({ ...(project ? { project } : {}), limit: QUIZ_CARDS })
    if (!res.cards.length) {
      void say('Nothing is due for review right now. We can keep talking about your notes instead.')
      return
    }
    quizRef.current = { sessionId: res.sessionId, cards: res.cards, index: 0 }
    await askCard()
  }, [project, askCard, say])

  const quizTurn = useCallback(
    async (text: string) => {
      const st = quizState.current!
      const step = quizInput(st, text)
      quizState.current = step.next
      setQuiz(step.next)
      const o = step.outcome
      if (!o) {
        void say(step.say, step.next.stage === 'grade' ? step.next.q.citations : undefined)
        return
      }
      if (o.type === 'stop') {
        quizRef.current = null
        quizState.current = null
        setQuiz(null)
        void say(step.say)
        return
      }
      const qz = quizRef.current!
      if (o.type === 'grade') {
        const n = step.next
        try {
          await window.lkv.study.answer({
            sessionId: qz.sessionId,
            cardId: qz.cards[qz.index].card_id,
            question: n.q.question,
            attempt: n.attempt,
            dontKnow: n.dontKnow,
            confidence: n.dontKnow ? 0 : n.confidence,
            grade: o.grade,
            answer: n.q.answer ?? n.q.quote ?? null,
            ...(n.q.mode ? { mode: n.q.mode } : {}),
            ...(isMultipleChoice(n.q) && n.picked && !n.dontKnow ? { chosenOption: n.picked } : {}),
          })
        } catch (e) {
          setNotice(e instanceof Error ? e.message : String(e))
        }
        tallyRef.current = { ...tallyRef.current, [o.grade]: tallyRef.current[o.grade] + 1 }
      }
      // The spoken step (the reveal, or "Nice.") comes before the next question.
      await say(step.say, o.type === 'grade' ? step.next.q.citations : undefined)
      qz.index++
      await askCard()
    },
    [say, askCard]
  )

  const setTeachState = (st: TeachState | null) => {
    teachRef.current = st
    setTeach(st)
  }

  const finishTeach = useCallback(
    (st: TeachState, before = '') => {
      setTeachState(null)
      const sum = summarize(st)
      setLesson(sum.missed.length ? sum : null)
      void say(`${before}${sum.say}`)
    },
    [say]
  )

  /** Teach mode (#418): plan the lesson from notes, then walk through it. */
  const startLesson = useCallback(
    async (input: { itemIds?: string[]; project?: string }) => {
      const plan = window.lkv?.teach?.plan
      if (!plan) return
      quizRef.current = null
      quizState.current = null
      setQuiz(null)
      setLesson(null)
      setBusy('thinking')
      try {
        const p = await plan(input)
        setBusy('idle')
        if (p.notice) setNotice(p.notFound ? null : p.notice)
        if (p.notFound || !p.concepts.length) {
          void say(p.notice ?? 'I couldn’t find that in your notes.')
          return
        }
        const st = startTeach(p)
        setTeachState(st)
        const titles = p.concepts.map((c) => c.title).join(', ')
        void say(
          `Let’s learn this in ${p.concepts.length} steps: ${titles}. Say slower, give me an example, skip or go back any time. ${conceptSpeech(st)}`,
          [{ id: p.concepts[0].sourceId, title: p.concepts[0].sourceTitle }]
        )
      } catch (e) {
        setBusy('idle')
        setNotice(e instanceof Error ? e.message : String(e))
      }
    },
    [say]
  )

  /** Move on, saying `before` (feedback on the last answer) first in the same reply. */
  const nextConcept = useCallback(
    (st: TeachState, before = '', citations: Citation[] = []) => {
      const next = goTo(st, st.index + 1)
      if (isDone(next)) {
        finishTeach(next, before)
        return
      }
      setTeachState(next)
      const c = teachConcept(next)!
      const cites = [...citations.filter((x) => x.id !== c.sourceId), { id: c.sourceId, title: c.sourceTitle }]
      void say(`${before}${conceptSpeech(next)}`, cites)
    },
    [say, finishTeach]
  )

  const teachTurn = useCallback(
    async (text: string) => {
      const st = teachRef.current!
      const c = teachConcept(st)!
      const cite = [{ id: c.sourceId, title: c.sourceTitle }]
      const cmd = parseTeachCommand(text)
      if (cmd === 'stop') return finishTeach(st)
      if (cmd === 'skip') return nextConcept(mark(st, 'skipped'))
      if (cmd === 'back') {
        const prev = goTo(st, st.index - 1)
        setTeachState(prev)
        const pc = teachConcept(prev)!
        return void say(conceptSpeech(prev), [{ id: pc.sourceId, title: pc.sourceTitle }])
      }
      if (cmd === 'repeat') return void say(st.phase === 'check' ? conceptSpeech(st) : st.question, cite)
      if (cmd === 'slower') return void say(`Let’s take it slowly. ${c.explain} Quick check: ${st.question}`, cite, 0.8)
      if (cmd === 'example') return void say(exampleSpeech(c), cite)
      if (cmd === 'hint') {
        const h = studyHint({ title: c.sourceTitle, answer: c.answer, quote: c.quote, sectionText: '' }, st.hintsGiven + 1)
        setTeachState({ ...st, hintsGiven: st.hintsGiven + 1 })
        return void say(h ? `Hint: ${h}` : `That’s all the hints I have. Give it a try: ${st.question}`, cite)
      }
      if (st.phase === 'why') {
        return nextConcept(st, 'Good. Putting it in your own words helps it stick. ')
      }
      const check = window.lkv?.teach?.check
      if (!check) return
      setBusy('thinking')
      try {
        const fb = await check({ concept: c, question: st.question, attempt: text, hintsGiven: st.hintsGiven, askWhy: st.rightCount % 2 === 1 })
        setBusy('idle')
        if (fb.retry) {
          setTeachState({ ...st, hintsGiven: st.hintsGiven + 1 })
          return void say(fb.say, fb.citations)
        }
        if (fb.verdict === 'right') {
          const marked = { ...mark(st, 'covered'), rightCount: st.rightCount + 1 }
          if (fb.followUp && st.phase === 'check') {
            setTeachState({ ...marked, phase: 'why', question: fb.followUp })
            return void say(fb.say, fb.citations)
          }
          return nextConcept(marked, `${fb.say} `, fb.citations)
        }
        // Still off after a hint: re-explained, now a follow-up check. A wrong
        // follow-up gets the explanation and then the lesson moves on.
        const missed = mark(st, 'missed')
        if (st.phase === 'check' && fb.followUp) {
          setTeachState({ ...missed, phase: 'followup', question: fb.followUp, hintsGiven: 1 })
          return void say(fb.say, fb.citations)
        }
        return nextConcept(missed, `${fb.say.replace(/\s*Now try this:.*$/, '')} `, fb.citations)
      } catch (e) {
        setBusy('idle')
        setNotice(e instanceof Error ? e.message : String(e))
      }
    },
    [say, nextConcept, finishTeach]
  )

  const addMissedToStudy = async () => {
    if (!lesson || !window.lkv?.teach?.missed) return
    try {
      const r = await window.lkv.teach.missed(lesson.missedNoteIds)
      setLesson(null)
      void say(`Done: ${r.cards} Study ${r.cards === 1 ? 'card is' : 'cards are'} due now from ${lesson.missedNoteIds.length === 1 ? 'that note' : 'those notes'}.`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    }
  }

  // "Teach me this" on a note.
  useEffect(() => {
    if (!teachNoteId) return
    onTeachStarted?.()
    void startLesson({ itemIds: [teachNoteId] })
  }, [teachNoteId, onTeachStarted, startLesson])

  /** One learner turn, spoken or typed. */
  const respond = useCallback(
    async (text: string) => {
      const t = text.trim()
      if (!t) return
      stopSpeaking()
      add('you', t)
      if (teachRef.current) {
        await teachTurn(t)
        return
      }
      if (quizState.current) {
        await quizTurn(t)
        return
      }
      if (parseSpokenCommand(t) === 'stop') {
        stop()
        void say('Okay. Press Start talking whenever you want to pick this up again.')
        return
      }
      if (TEACH_WORDS.test(t)) {
        await startLesson(project ? { project } : {})
        return
      }
      if (QUIZ_WORDS.test(t)) {
        await startQuiz()
        return
      }
      const chat = window.lkv?.chat
      if (!chat?.send) return
      setBusy('thinking')
      try {
        if (!sessionRef.current) {
          const s = await chat.createSession({ title: project ? `Talk: ${project}` : 'Talk it through', ...(project ? { filters: { project } } : {}) })
          sessionRef.current = s.id
        }
        const res = await chat.send({
          sessionId: sessionRef.current,
          text: t,
          ...(project ? { filters: { project } } : {}),
          spoken: true,
        })
        setBusy('idle')
        if (res.offline) setNotice('No AI model answered, so this reply is search results only. Check Settings → AI providers.')
        void say(res.assistant.content, parseCitations(res.assistant.citations_json))
      } catch (e) {
        setBusy('idle')
        setNotice(e instanceof Error ? e.message : String(e))
      }
    },
    [project, quizTurn, teachTurn, startQuiz, startLesson, say, stopSpeaking, stop]
  )

  talk.setOnTurn(respond)

  // Push-to-talk: hold to talk, let go to send.
  const holding = useRef(false)
  const pttDown = () => {
    if (holding.current) return
    holding.current = true
    stopSpeaking()
    void mic.listen().then((r) => {
      if ('text' in r) void respond(r.text)
    })
  }
  const pttUp = () => {
    if (!holding.current) return
    holding.current = false
    mic.stop()
  }

  return (
    <Box data-testid="talk-view" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, p: 1.5, minHeight: 0 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <ProjectSelect value={project} onChange={onProjectChange} />
        <Typography variant="body2" sx={{ color: 'text.secondary', flex: 1, minWidth: 200 }}>
          Talk about your notes: ask Vault to explain something, say “teach me” for a lesson, or “quiz me”. Answers come
          from your notes, with sources below each reply.
        </Typography>
      </Stack>

      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<SchoolIcon />}
          disabled={!project || busy === 'thinking' || !!teach}
          onClick={() => void startLesson({ project })}
        >
          {project ? `Teach me ${project}` : 'Teach me this (pick a project)'}
        </Button>
        <Button size="small" variant="outlined" startIcon={<ContentPasteIcon />} disabled={!!teach} onClick={() => setPasteOpen(true)}>
          Paste notes to learn
        </Button>
      </Stack>
      <PasteToLearnDialog
        open={pasteOpen}
        project={project}
        onClose={() => setPasteOpen(false)}
        onSaved={(item) => {
          setPasteOpen(false)
          void startLesson({ itemIds: [item.id] })
        }}
      />

      {!voice.enabled && (
        <Alert severity="info" data-testid="talk-voice-off">
          Voice is off, so this works in text. Turn on Voice study in Settings → AI providers to talk out loud.
        </Alert>
      )}
      {voice.enabled && voice.status && !voice.status.canTranscribe && voice.status.sttHint && (
        <Alert severity="info" data-testid="talk-stt-hint">
          {voice.status.sttHint}
        </Alert>
      )}
      {(notice || mic.error) && (
        <Alert
          severity="warning"
          onClose={() => {
            setNotice(null)
            mic.setError(null)
          }}
        >
          {notice ?? mic.error}
        </Alert>
      )}

      {voice.enabled && (
        <Card variant="outlined">
          <CardContent sx={{ pb: '12px !important' }}>
            <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              {handsFree ? (
                running ? (
                  <Button variant="contained" color="error" startIcon={<StopIcon />} onClick={stop}>
                    Stop
                  </Button>
                ) : (
                  <Button variant="contained" startIcon={<MicIcon />} disabled={!canHear} onClick={start}>
                    Start talking
                  </Button>
                )
              ) : (
                <Button
                  variant="contained"
                  startIcon={<MicIcon />}
                  disabled={!canHear || mic.phase === 'transcribing'}
                  color={mic.phase === 'listening' ? 'error' : 'primary'}
                  onPointerDown={pttDown}
                  onPointerUp={pttUp}
                  onPointerLeave={pttUp}
                  onKeyDown={(e) => {
                    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                      e.preventDefault()
                      pttDown()
                    }
                  }}
                  onKeyUp={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') pttUp()
                  }}
                >
                  Hold to talk
                </Button>
              )}
              {busy === 'speaking' && (
                <Button size="small" onClick={stopSpeaking}>
                  Interrupt
                </Button>
              )}
              {!quiz && !teach && (
                <Button size="small" startIcon={<QuizIcon />} onClick={() => void respond('Quiz me')} disabled={busy === 'thinking'}>
                  Quiz me
                </Button>
              )}
              <FormControlLabel
                sx={{ ml: 'auto' }}
                control={
                  <Switch
                    size="small"
                    checked={handsFree}
                    disabled={running}
                    onChange={(e) => setHandsFree(e.target.checked)}
                  />
                }
                label="Hands-free"
              />
            </Stack>
            <Typography variant="caption" role="status" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
              {status}
            </Typography>
            {mic.phase === 'listening' && (
              <LinearProgress variant="determinate" value={Math.min(100, mic.level * 800)} aria-label="Microphone level" sx={{ mt: 0.5 }} />
            )}
          </CardContent>
        </Card>
      )}

      {teach && teachConcept(teach) && (
        <Card variant="outlined" data-testid="talk-teach">
          <CardContent>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Lesson · concept {teach.index + 1} of {teach.concepts.length}
              {teach.phase === 'followup' ? ' · follow-up' : teach.phase === 'why' ? ' · why?' : ''}
            </Typography>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {teachConcept(teach)!.title}
            </Typography>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              {teach.question}
            </Typography>
            <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', mb: 1 }} aria-label="Lesson progress">
              {teach.concepts.map((c, i) => (
                <Chip
                  key={c.id}
                  size="small"
                  label={c.title}
                  variant={i === teach.index ? 'filled' : 'outlined'}
                  color={teach.status[c.id] === 'covered' ? 'success' : teach.status[c.id] === 'missed' ? 'warning' : 'default'}
                />
              ))}
            </Stack>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {(
                [
                  ['slower', 'Slower'],
                  ['give me an example', 'Example'],
                  ['hint', 'Hint'],
                  ['go back', 'Go back'],
                  ['skip', 'Skip'],
                  ['stop', 'End lesson'],
                ] as const
              ).map(([word, label]) => (
                <Button key={word} size="small" onClick={() => void respond(word)} disabled={busy === 'thinking'}>
                  {label}
                </Button>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      {lesson && (
        <Alert
          severity="info"
          data-testid="teach-missed"
          action={
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => void addMissedToStudy()}>
                Add to Study
              </Button>
              <Button size="small" onClick={() => setLesson(null)}>
                Not now
              </Button>
            </Stack>
          }
        >
          Add {lesson.missed.length === 1 ? 'the concept' : `the ${lesson.missed.length} concepts`} you missed to Study? The cards for{' '}
          {lesson.missedNoteIds.length === 1 ? 'its note' : 'their notes'} (
          {[...new Set(lesson.missed.map((c) => c.sourceTitle))].join(', ')}) will be due now.
        </Alert>
      )}

      {quiz && (
        <Card variant="outlined" data-testid="talk-quiz">
          <CardContent>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Quiz · {quiz.stage === 'answer' ? 'answer from memory first' : quiz.stage === 'confidence' ? 'how sure are you?' : 'grade yourself'}
            </Typography>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {quiz.q.question}
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1, flexWrap: 'wrap' }}>
              {quiz.stage === 'answer' && (
                <>
                  <Button size="small" onClick={() => void respond('hint')}>
                    Hint
                  </Button>
                  <Button size="small" onClick={() => void respond('I don’t know')}>
                    I don’t know
                  </Button>
                </>
              )}
              {quiz.stage === 'grade' &&
                (
                  [
                    ['missed', 'Missed'],
                    ['partly', 'Partly'],
                    ['got it', 'Got it'],
                  ] as const
                ).map(([word, label]) => (
                  <Button key={word} size="small" variant="outlined" onClick={() => void respond(word)}>
                    {label}
                  </Button>
                ))}
              <Button size="small" onClick={() => void respond('stop')}>
                End quiz
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      <Stack spacing={1} data-testid="talk-transcript" aria-live="polite">
        {lines.map((l) => (
          <Box
            key={l.id}
            sx={{
              alignSelf: l.role === 'you' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              bgcolor: l.role === 'you' ? 'primary.50' : 'background.paper',
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              px: 1.5,
              py: 1,
            }}
          >
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {l.role === 'you' ? 'You' : 'Vault'}
            </Typography>
            {l.role === 'vault' ? (
              <Box sx={{ typography: 'body2' }}>
                <AnswerText text={l.text} citations={l.citations} onSelectCitation={onOpenNote} />
              </Box>
            ) : (
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {l.text}
              </Typography>
            )}
            {!!l.citations?.length && (
              <Stack direction="row" spacing={0.5} useFlexGap sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                {l.citations.map((c) => (
                  <Chip
                    key={c.id}
                    size="small"
                    variant="outlined"
                    color="primary"
                    icon={<OpenInNewIcon fontSize="small" />}
                    label={`Source: ${c.title}`}
                    onClick={onOpenNote ? () => onOpenNote(c.id) : undefined}
                  />
                ))}
              </Stack>
            )}
          </Box>
        ))}
      </Stack>

      <Stack
        direction="row"
        spacing={1}
        component="form"
        onSubmit={(e) => {
          e.preventDefault()
          const t = typed
          setTyped('')
          void respond(t)
        }}
      >
        <TextField
          size="small"
          fullWidth
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={teach || quiz ? 'Type your answer (or “hint”)' : 'Type instead: ask about your notes, “teach me” or “quiz me”'}
          slotProps={{ htmlInput: { 'aria-label': 'Type a message' } }}
        />
        <Button type="submit" variant="outlined" disabled={!typed.trim() || busy === 'thinking'}>
          Send
        </Button>
      </Stack>
    </Box>
  )
}

