import { describe, expect, it } from 'vitest'
import {
  createTurnDetector,
  downsample,
  encodeWav,
  parseSpokenCommand,
  parseSpokenConfidence,
  parseSpokenGrade,
  rms,
  speakableText,
  splitSentences,
  studyHint,
} from '../../src/features/voice/speech'

describe('voice speech helpers (#413)', () => {
  it('reads aloud without citation ids or markdown', () => {
    expect(speakableText('## Cells\n- **ATP** is made in [the mitochondria](http://x) [itm_abc123].\n1. Next `code`')).toBe(
      'Cells ATP is made in the mitochondria. Next code'
    )
    expect(speakableText('```js\nx()\n```Done')).toBe('Done')
    expect(speakableText(undefined as unknown as string)).toBe('')
  })

  it('splits sentences', () => {
    expect(splitSentences('One. Two? Three! Four')).toEqual(['One.', 'Two?', 'Three!', 'Four'])
    expect(splitSentences('  ')).toEqual([])
  })

  it('downsamples and encodes 16-bit WAV', () => {
    const s = new Float32Array([1, 1, -1, -1, 0.5, 0.5])
    expect(Array.from(downsample(s, 32000, 16000))).toEqual([1, -1, 0.5])
    expect(downsample(s, 16000, 16000)).toBe(s)
    expect(downsample(new Float32Array(0), 48000)).toHaveLength(0)
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16000)
    const v = new DataView(wav.buffer)
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getUint32(40, true)).toBe(8)
    expect(v.getInt16(46, true)).toBe(0x7fff)
    expect(v.getInt16(48, true)).toBe(-0x8000)
    expect(v.getInt16(50, true)).toBe(0x7fff)
  })

  it('measures frame level', () => {
    expect(rms(new Float32Array(0))).toBe(0)
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5)
  })

  it('detects a spoken turn ending on a pause', () => {
    const d = createTurnDetector({ threshold: 0.1, silenceMs: 500, minSpeechMs: 100, maxWaitMs: 5000 })
    expect(d.step(0, 0)).toBe('waiting')
    expect(d.step(0.5, 50)).toBe('waiting')
    expect(d.step(0, 80)).toBe('waiting') // a click, not speech
    expect(d.step(0.5, 100)).toBe('waiting')
    expect(d.step(0.5, 250)).toBe('speaking')
    expect(d.step(0.5, 400)).toBe('speaking')
    expect(d.step(0, 800)).toBe('speaking')
    expect(d.step(0, 950)).toBe('done')
    expect(d.step(1, 1000)).toBe('done')
    expect(d.state).toBe('done')
  })

  it('times out when nobody talks, and caps a long turn', () => {
    const quiet = createTurnDetector({ maxWaitMs: 1000 })
    quiet.step(0, 0)
    expect(quiet.step(0, 1000)).toBe('timeout')
    expect(quiet.step(1, 1100)).toBe('timeout')
    let bar = 0.5
    const long = createTurnDetector({ threshold: () => bar, minSpeechMs: 0, maxTurnMs: 1000 })
    expect(long.step(0.4, 0)).toBe('waiting')
    bar = 0.1
    expect(long.step(0.4, 10)).toBe('speaking')
    expect(long.step(0.4, 1500)).toBe('done')
  })

  it('understands spoken grades', () => {
    expect(parseSpokenGrade('I missed it')).toBe('again')
    expect(parseSpokenGrade('partly')).toBe('hard')
    expect(parseSpokenGrade('Got it!')).toBe('good')
    expect(parseSpokenGrade('banana')).toBeNull()
  })

  it('understands spoken confidence', () => {
    expect(parseSpokenConfidence('about 72 percent')).toBe(70)
    expect(parseSpokenConfidence('150')).toBe(100)
    expect(parseSpokenConfidence('eighty')).toBe(80)
    expect(parseSpokenConfidence('no idea')).toBe(10)
    expect(parseSpokenConfidence('very sure')).toBe(90)
    expect(parseSpokenConfidence('pretty sure')).toBe(70)
    expect(parseSpokenConfidence('not sure')).toBe(40)
    expect(parseSpokenConfidence('sure')).toBe(70)
    expect(parseSpokenConfidence('purple')).toBeNull()
  })

  it('understands whole-utterance commands only', () => {
    expect(parseSpokenCommand('Stop.')).toBe('stop')
    expect(parseSpokenCommand('give me a hint please')).toBe('hint')
    expect(parseSpokenCommand("I don't know")).toBe('dontKnow')
    expect(parseSpokenCommand('say that again')).toBe('repeat')
    expect(parseSpokenCommand('skip')).toBe('skip')
    expect(parseSpokenCommand('the hint is in the note')).toBeNull()
  })

  it('gives graduated hints that never state the answer', () => {
    const q = { title: 'Cells', answer: 'ATP', quote: 'Mitochondria make ATP for the cell.', sectionText: '' }
    expect(studyHint(q, 1)).toBe('Think about your note “Cells”.')
    expect(studyHint(q, 2)).toBe('The answer starts with “A” and has 3 letters.')
    expect(studyHint(q, 3)).toBe('Your note says: “Mitochondria make ___ for the cell.”.')
    expect(studyHint(q, 4)).toBeNull()
    expect(studyHint({ ...q, answer: 'adenosine triphosphate' }, 2)).toBe('The answer is 2 words and starts with “A”.')
    expect(studyHint({ ...q, quote: 'Unrelated words.' }, 3)).toBeNull()
    expect(studyHint({ ...q, answer: null, quote: 'Explain it.' }, 2)).toBe('Your note says: “Explain it.”.')
    expect(studyHint({ ...q, answer: null, quote: null }, 2)).toBeNull()
  })
})
