import type { PracticeTestImportResult } from '../../../electron/types'

/** "4 cards added, 12 need question text, 6 skipped" (#265). */
export function importSummary(r: Pick<PracticeTestImportResult, 'added' | 'needText' | 'skipped' | 'alreadyAdded'>): string {
  const parts = [`${r.added} ${r.added === 1 ? 'card' : 'cards'} added`]
  if (r.needText.length > 0) parts.push(`${r.needText.length} need question text`)
  if (r.skipped.length > 0) parts.push(`${r.skipped.length} skipped`)
  if (r.alreadyAdded > 0) parts.push(`${r.alreadyAdded} already in Study`)
  return parts.join(', ')
}

/** "2 linked to your notes · 1 corrective draft to confirm in your own words". */
export function linkSummary(r: Pick<PracticeTestImportResult, 'linked' | 'drafts'>): string {
  const parts: string[] = []
  if (r.linked > 0) parts.push(`${r.linked} linked to your notes`)
  if (r.drafts > 0) parts.push(`${r.drafts} corrective ${r.drafts === 1 ? 'draft' : 'drafts'} to confirm in your own words`)
  return parts.join(' · ')
}

/** Today as YYYY-MM-DD in local time. */
export function todayLocal(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A test name from the paste's first line, e.g. "Practice Exam: Core 2 (220-1202) — Results". */
export function guessTestName(raw: string): string {
  const lines = (raw ?? '').split('\n').map((l) => l.trim()).filter((l) => l)
  // A CSV export has no title line.
  if (/^"?question"?\s*,/i.test(lines[0] ?? '')) return ''
  const first = lines.find((l) => !/^example data\b/i.test(l) && !/^(?:\d+[.)]|q\s*\d+\s*:|question\s+\d+)/i.test(l))
  if (!first) return ''
  return first
    .replace(/\s*[—–-]\s*(?:results?|my results|review)\s*$/i, '')
    .replace(/[\s:—–-]+$/, '')
    .slice(0, 80)
}
