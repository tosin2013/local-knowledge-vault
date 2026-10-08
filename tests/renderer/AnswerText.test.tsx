import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AnswerText, CitationChips } from '../../src/components/answer/AnswerText'
import { parseAnswerBlocks, parseInline } from '../../src/answerFormat'

const CITES = [
  { id: 'itm_a1', title: 'Note A' },
  { id: 'itm_b2', title: 'Note B' },
]

describe('answer format parser (#238)', () => {
  it('splits headings, lists, code and paragraphs', () => {
    const blocks = parseAnswerBlocks(
      ['## Summary', 'First line', 'second line', '', '- one', '- two', '', '1. first', '2. second', '```', 'x = 1', '```', '---', 'Tail'].join('\n'),
    )
    expect(blocks).toEqual([
      { kind: 'h', level: 2, text: 'Summary' },
      { kind: 'p', text: 'First line\nsecond line' },
      { kind: 'ul', items: ['one', 'two'] },
      { kind: 'ol', items: ['first', 'second'], start: 1 },
      { kind: 'code', text: 'x = 1' },
      { kind: 'p', text: 'Tail' },
    ])
  })

  it('keeps loose lists together and joins indented continuation lines', () => {
    expect(parseAnswerBlocks('* a\n\n* b\n  more of b')).toEqual([{ kind: 'ul', items: ['a', 'b\nmore of b'] }])
    expect(parseAnswerBlocks('3) three\n4) four')).toEqual([{ kind: 'ol', items: ['three', 'four'], start: 3 }])
  })

  it('parses bold, italic, code and citations, leaving the rest literal', () => {
    expect(parseInline('**Bold [itm_a1]** and *it* and `c*d` [itm_b2]')).toEqual([
      { kind: 'bold', children: [{ kind: 'text', text: 'Bold ' }, { kind: 'cite', id: 'itm_a1' }] },
      { kind: 'text', text: ' and ' },
      { kind: 'italic', children: [{ kind: 'text', text: 'it' }] },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'c*d' },
      { kind: 'text', text: ' ' },
      { kind: 'cite', id: 'itm_b2' },
    ])
    expect(parseInline('snake_case_name and 2 * 3 * 4')).toEqual([{ kind: 'text', text: 'snake_case_name and 2 * 3 * 4' }])
    expect(parseInline('an **unclosed marker')).toEqual([{ kind: 'text', text: 'an **unclosed marker' }])
  })
})

describe('AnswerText (#238)', () => {
  it('renders Markdown instead of raw symbols', () => {
    render(<AnswerText text={'## Key points\n\n- **Habits** compound\n- Use `cues`'} />)
    expect(screen.getByRole('heading', { name: 'Key points' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Habits').tagName).toBe('STRONG')
    expect(screen.getByText('cues').tagName).toBe('CODE')
    expect(screen.queryByText(/##|\*\*/)).not.toBeInTheDocument()
  })

  it('numbers citations to match the chips and opens the note', () => {
    const onSelect = vi.fn()
    render(
      <>
        <AnswerText text="Alpha [itm_b2] then beta [itm_a1]." citations={CITES} onSelectCitation={onSelect} />
        <CitationChips citations={CITES} onSelectCitation={onSelect} />
      </>,
    )
    expect(screen.queryByText(/itm_/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Citation 2: Note B' }))
    expect(onSelect).toHaveBeenLastCalledWith('itm_b2')
    fireEvent.click(screen.getByText('[1] Note A'))
    expect(onSelect).toHaveBeenLastCalledWith('itm_a1')
  })

  it('shows non-clickable numbers without a handler and leaves unknown markers literal', () => {
    render(<AnswerText text="Known [itm_a1], unknown [itm_zz9]." citations={CITES} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Citation 1: Note A')).toHaveTextContent('[1]')
    expect(screen.getByText(/\[itm_zz9\]/)).toBeInTheDocument()
  })

  it('never turns model text into HTML', () => {
    const { container } = render(<AnswerText text={'<img src=x onerror=alert(1)> **ok**'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument()
  })

  it('can show text as written', () => {
    render(<AnswerText text={'**not bold** [itm_a1]'} citations={CITES} markdown={false} />)
    expect(screen.getByText(/\*\*not bold\*\*/)).toBeInTheDocument()
    expect(screen.getByLabelText('Citation 1: Note A')).toBeInTheDocument()
  })
})
