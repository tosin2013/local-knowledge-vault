import { Fragment, type ReactNode } from 'react'
import { Box, Chip, Link, Stack, Typography } from '@mui/material'
import type { Citation } from '../../../electron/types'
import { parseAnswerBlocks, parseInline, type InlineToken } from '../../answerFormat'

export interface AnswerTextProps {
  /** Answer text from the model. */
  text: string
  /** Validated citations, in order; marker [itm_x] renders as its 1-based number. */
  citations?: Citation[]
  /** Open a cited note. Without it, citations are shown but not clickable. */
  onSelectCitation?: (id: string) => void
  /** Render light Markdown (default). False shows the text as written. */
  markdown?: boolean
}

const citeSx = {
  color: 'primary.main',
  textDecoration: 'none',
  verticalAlign: 'super',
  fontSize: '0.72em',
  fontWeight: 600,
} as const

const codeSx = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: '0.85em',
  bgcolor: 'action.hover',
  borderRadius: 1,
} as const

/**
 * One way to show a grounded answer everywhere (chat, personality preview, Study mode)
 * (#238): light Markdown, numbered inline citations that match the numbered source chips.
 * Builds React elements only, so model text can never inject HTML.
 */
export function AnswerText({ text, citations = [], onSelectCitation, markdown = true }: AnswerTextProps) {
  const indexById = new Map<string, number>()
  citations.forEach((c, i) => indexById.set(c.id, i))

  const renderInline = (tokens: InlineToken[], key = ''): ReactNode[] =>
    tokens.map((t, i) => {
      const k = `${key}${i}`
      switch (t.kind) {
        case 'text':
          return <Fragment key={k}>{t.text}</Fragment>
        case 'bold':
          return <strong key={k}>{renderInline(t.children, `${k}.`)}</strong>
        case 'italic':
          return <em key={k}>{renderInline(t.children, `${k}.`)}</em>
        case 'code':
          return (
            <Box key={k} component="code" sx={{ ...codeSx, px: 0.5 }}>
              {t.text}
            </Box>
          )
        case 'cite': {
          const idx = indexById.get(t.id)
          if (idx === undefined) return <Fragment key={k}>{`[${t.id}]`}</Fragment>
          const c = citations[idx]
          const label = `Citation ${idx + 1}: ${c.title}`
          if (!onSelectCitation) {
            return (
              <Box key={k} component="sup" aria-label={label} title={c.title} sx={{ ...citeSx, verticalAlign: 'baseline' }}>
                [{idx + 1}]
              </Box>
            )
          }
          return (
            <Link
              key={k}
              component="button"
              onClick={() => onSelectCitation(c.id)}
              aria-label={label}
              title={c.title}
              sx={{ ...citeSx, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
            >
              [{idx + 1}]
            </Link>
          )
        }
      }
    })

  const inline = (s: string, key: string) => renderInline(markdown ? parseInline(s) : citeOnly(s), key)

  if (!markdown) {
    return (
      <Typography variant="body2" component="div" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, wordBreak: 'break-word' }}>
        {inline(text, 'r')}
      </Typography>
    )
  }

  const blocks = parseAnswerBlocks(text)
  return (
    <Box
      data-testid="answer-text"
      sx={{
        typography: 'body2',
        lineHeight: 1.55,
        wordBreak: 'break-word',
        '& > *:first-of-type': { mt: 0 },
        '& > *:last-child': { mb: 0 },
      }}
    >
      {blocks.map((b, i) => {
        const key = `b${i}`
        if (b.kind === 'p') {
          return (
            <Typography key={key} variant="body2" component="p" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, my: 0.75 }}>
              {inline(b.text, key)}
            </Typography>
          )
        }
        if (b.kind === 'h') {
          return (
            <Typography
              key={key}
              component={`h${Math.min(b.level + 2, 6)}` as 'h3'}
              variant="subtitle2"
              sx={{ fontWeight: 700, mt: 1.25, mb: 0.5, fontSize: b.level <= 2 ? '0.95rem' : '0.875rem' }}
            >
              {inline(b.text, key)}
            </Typography>
          )
        }
        if (b.kind === 'code') {
          return (
            <Box key={key} component="pre" sx={{ ...codeSx, p: 1, my: 0.75, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
              {b.text}
            </Box>
          )
        }
        const ListTag = b.kind === 'ul' ? 'ul' : 'ol'
        return (
          <Box
            key={key}
            component={ListTag}
            {...(b.kind === 'ol' && b.start !== 1 ? { start: b.start } : {})}
            sx={{ pl: 3, my: 0.75, '& li': { mb: 0.25 } }}
          >
            {b.items.map((item, j) => (
              <Typography key={j} component="li" variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                {inline(item, `${key}.${j}.`)}
              </Typography>
            ))}
          </Box>
        )
      })}
    </Box>
  )
}

/** Plain text with only citation markers turned into tokens. */
function citeOnly(s: string): InlineToken[] {
  const out: InlineToken[] = []
  const re = /\[(itm_[a-zA-Z0-9]+)\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ kind: 'text', text: s.slice(last, m.index) })
    out.push({ kind: 'cite', id: m[1] })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) })
  return out
}

/** Numbered source chips that match the inline citation numbers. */
export function CitationChips({
  citations,
  onSelectCitation,
  titleFor,
}: {
  citations: Citation[]
  onSelectCitation?: (id: string) => void
  titleFor?: (c: Citation) => string
}) {
  if (!citations.length) return null
  return (
    <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 1 }}>
      {citations.map((c, i) => (
        <Chip
          key={c.id}
          size="small"
          label={`[${i + 1}] ${c.title}`}
          color="primary"
          variant="outlined"
          onClick={onSelectCitation ? () => onSelectCitation(c.id) : undefined}
          title={titleFor ? titleFor(c) : c.title}
        />
      ))}
    </Stack>
  )
}
