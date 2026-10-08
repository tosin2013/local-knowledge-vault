/**
 * Light Markdown for model answers (#238): headings, bullet and numbered lists, code
 * blocks, **bold**, *italic*, `code` and [itm_…] citation markers. Pure and dependency
 * free; the renderer turns these tokens into React text nodes (never HTML strings).
 */

export type AnswerBlock =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[]; start: number }
  | { kind: 'code'; text: string }

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: InlineToken[] }
  | { kind: 'italic'; children: InlineToken[] }
  | { kind: 'code'; text: string }
  | { kind: 'cite'; id: string }

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/
const UL_RE = /^\s{0,3}[-*•+]\s+(.*)$/
const OL_RE = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/
const FENCE_RE = /^\s{0,3}```/
const RULE_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/

/** Split an answer into blocks. Unknown syntax stays as plain paragraph text. */
export function parseAnswerBlocks(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = []
  const lines = (text ?? '').replace(/\r\n?/g, '\n').split('\n')
  let para: string[] = []
  // A list stays open across blank lines until something else appears.
  let listOpen = false

  const flushPara = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join('\n') })
    para = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (FENCE_RE.test(line)) {
      flushPara()
      const body: string[] = []
      i++
      while (i < lines.length && !FENCE_RE.test(lines[i])) body.push(lines[i++])
      blocks.push({ kind: 'code', text: body.join('\n') })
      listOpen = false
      continue
    }
    if (!line.trim()) {
      flushPara()
      continue
    }
    const h = HEADING_RE.exec(line)
    if (h) {
      flushPara()
      blocks.push({ kind: 'h', level: h[1].length, text: h[2] })
      listOpen = false
      continue
    }
    if (RULE_RE.test(line)) {
      flushPara()
      listOpen = false
      continue
    }
    const ul = UL_RE.exec(line)
    const ol = ul ? null : OL_RE.exec(line)
    if (ul || ol) {
      flushPara()
      const last = blocks[blocks.length - 1]
      const kind = ul ? 'ul' : 'ol'
      const item = (ul ? ul[1] : ol![2]).trim()
      if (listOpen && last && last.kind === kind) last.items.push(item)
      else if (kind === 'ul') blocks.push({ kind: 'ul', items: [item] })
      else blocks.push({ kind: 'ol', items: [item], start: Number(ol![1]) || 1 })
      listOpen = true
      continue
    }
    const last = blocks[blocks.length - 1]
    if (listOpen && para.length === 0 && /^\s{2,}\S/.test(line) && last && (last.kind === 'ul' || last.kind === 'ol')) {
      // Indented continuation of the previous list item.
      last.items[last.items.length - 1] += `\n${line.trim()}`
      continue
    }
    listOpen = false
    para.push(line)
  }
  flushPara()
  return blocks
}

const INLINE_RE =
  /(`[^`\n]+`)|(\*\*[^*\n](?:[^*\n]|\*(?!\*))*?\*\*)|(__[^_\n]+__)|(\[itm_[a-zA-Z0-9]+\])|((?<![\w*])\*(?![\s*])[^*\n]*?[^\s*]\*(?![\w*]))|((?<![A-Za-z0-9_])_(?![\s_])[^_\n]*?[^\s_]_(?![A-Za-z0-9_]))/g

/** Inline tokens for one block of text. Unmatched markers stay literal. */
export function parseInline(text: string): InlineToken[] {
  const out: InlineToken[] = []
  const push = (t: InlineToken) => {
    const prev = out[out.length - 1]
    if (t.kind === 'text' && prev && prev.kind === 'text') prev.text += t.text
    else out.push(t)
  }
  let last = 0
  const re = new RegExp(INLINE_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) push({ kind: 'text', text: text.slice(last, m.index) })
    const [whole, code, bold, boldU, cite, italic, italicU] = m
    if (code) push({ kind: 'code', text: code.slice(1, -1) })
    else if (bold) push({ kind: 'bold', children: parseInline(bold.slice(2, -2)) })
    else if (boldU) push({ kind: 'bold', children: parseInline(boldU.slice(2, -2)) })
    else if (cite) push({ kind: 'cite', id: cite.slice(1, -1) })
    else if (italic) push({ kind: 'italic', children: parseInline(italic.slice(1, -1)) })
    else if (italicU) push({ kind: 'italic', children: parseInline(italicU.slice(1, -1)) })
    else push({ kind: 'text', text: whole })
    last = m.index + whole.length
  }
  if (last < text.length) push({ kind: 'text', text: text.slice(last) })
  return out
}
