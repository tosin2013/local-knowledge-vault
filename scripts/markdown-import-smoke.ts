/**
 * Offline smoke tests for Markdown / Obsidian folder import — no external network.
 *
 *   npm run test:markdown-import
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { closeDb, initDb, listItems } from '../electron/db'
import {
  firstHeading,
  importMarkdownFolder,
  inlineTags,
  normalizeWikiLinks,
  parseMarkdownNote,
  parseYamlFrontmatter,
  splitFrontmatter,
} from '../electron/import-markdown'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${msg}`)
  } else {
    failed++
    console.error(`  ✗ ${msg}`)
  }
}

function main(): void {
  console.log('\n=== Local Knowledge Vault — Markdown import smoke ===\n')

  // --- splitFrontmatter ---
  console.log('splitFrontmatter')
  const withFm = splitFrontmatter('---\ntitle: Hello\n---\n# Hello\n\nBody')
  assert(withFm.data.title === 'Hello', 'parses title from frontmatter')
  assert(withFm.body.startsWith('# Hello'), 'body keeps content after frontmatter')

  const withBom = splitFrontmatter('\uFEFF---\ntitle: BOM\n---\nBody')
  assert(withBom.data.title === 'BOM', 'strips BOM before frontmatter')

  const noFm = splitFrontmatter('Just a note')
  assert(noFm.data.title === undefined && noFm.body === 'Just a note', 'no frontmatter → body unchanged')

  // --- parseYamlFrontmatter ---
  console.log('\nparseYamlFrontmatter')
  const yaml = parseYamlFrontmatter(
    ['title: "Quoted Title"', 'summary: A summary', 'para: projects', 'kind: guide', 'status: archived', 'project: Work', 'tags: [a, b c]'].join('\n'),
  )
  assert(yaml.title === 'Quoted Title', 'unquotes scalar')
  assert(yaml.summary === 'A summary', 'parses summary')
  assert(yaml.para === 'projects', 'parses para')
  assert(yaml.kind === 'guide', 'parses kind')
  assert(yaml.status === 'archived', 'parses status')
  assert(yaml.project === 'Work', 'parses project')
  assert(JSON.stringify(yaml.tags) === JSON.stringify(['a', 'b', 'c']), 'parses inline array + space tags')

  const listTags = parseYamlFrontmatter('tags:\n  - travel\n  - journal\n')
  assert(JSON.stringify(listTags.tags) === JSON.stringify(['travel', 'journal']), 'parses indented tags list')

  // --- firstHeading ---
  console.log('\nfirstHeading')
  assert(firstHeading('# My Title\n\nbody') === 'My Title', 'extracts H1')
  assert(firstHeading('## Not a title\nbody') === null, 'H2 is not a title')
  assert(firstHeading('\n\n# Later\nbody') === 'Later', 'skips leading blank lines to H1')
  assert(firstHeading('plain first line\n# later') === null, 'returns null when first line is not H1')

  // --- normalizeWikiLinks ---
  console.log('\nnormalizeWikiLinks')
  assert(normalizeWikiLinks('See [[Target]] here') === 'See Target here', 'plain wikilink')
  assert(normalizeWikiLinks('See [[Target|alias]] here') === 'See alias here', 'aliased wikilink')
  assert(normalizeWikiLinks('Embed ![[Note]] ok') === 'Embed Note ok', 'embed wikilink')
  assert(normalizeWikiLinks('[[Note#Section]]') === 'Note', 'drops heading anchor')

  // --- inlineTags ---
  console.log('\ninlineTags')
  assert(JSON.stringify(inlineTags('a #tag and #other/thing')) === JSON.stringify(['tag', 'other/thing']), 'extracts inline tags')
  assert(inlineTags('## heading not a tag').length === 0, 'does not treat headings as tags')

  // --- parseMarkdownNote ---
  console.log('\nparseMarkdownNote')
  const parsed = parseMarkdownNote(
    'welcome.md',
    '---\ntitle: Welcome\npara: areas\nkind: guide\ntags: [start]\n---\n# Welcome\n\nHello [[World|there]].',
    { rootName: 'Vault', relDir: '' },
  )
  assert(parsed?.title === 'Welcome', 'title from frontmatter')
  assert(parsed?.para === 'areas', 'para from frontmatter')
  assert(parsed?.kind === 'guide', 'kind from frontmatter')
  assert(parsed?.project === 'start', 'project from first frontmatter tag')
  assert(parsed?.body === 'Hello there.', 'strips H1 and normalizes wikilink')

  const byHeading = parseMarkdownNote('plain.md', '# Plain\n\nBody', { rootName: 'Vault', relDir: '' })
  assert(byHeading?.title === 'Plain', 'title from H1')
  assert(byHeading?.body === 'Body', 'H1 removed from body')
  assert(byHeading?.project === 'Vault', 'project defaults to folder name')

  const empty = parseMarkdownNote('empty.md', '', { rootName: 'Vault', relDir: '' })
  assert(empty === null, 'empty file is skipped')

  // --- end-to-end importMarkdownFolder ---
  console.log('\nimportMarkdownFolder (temp tree)')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-md-'))
  const vault = path.join(root, 'Vault')
  const areas = path.join(vault, 'areas')
  fs.mkdirSync(areas, { recursive: true })

  fs.writeFileSync(path.join(vault, 'welcome.md'), '---\ntitle: Welcome\npara: areas\nkind: guide\ntags: [start, onboarding]\n---\n# Welcome\n\nHello [[World|there]].\n')
  fs.writeFileSync(path.join(vault, 'plain.md'), '# Plain note\n\nSome body with a [[link]].\n')
  fs.writeFileSync(path.join(vault, 'empty.md'), '')
  fs.writeFileSync(path.join(vault, 'notes.txt'), 'not markdown')
  fs.writeFileSync(path.join(vault, '.hidden.md'), '# hidden')
  fs.mkdirSync(path.join(vault, '.obsidian'), { recursive: true })
  fs.writeFileSync(path.join(vault, '.obsidian', 'app.json'), '{}')
  fs.writeFileSync(path.join(areas, 'nested.md'), 'Nested content, no heading.\n')
  fs.writeFileSync(path.join(areas, 'tagged.md'), '---\ntags:\n  - travel\n  - journal\n---\n# Trip\n\nNotes here.\n')
  fs.writeFileSync(path.join(areas, 'override.md'), '---\nproject: My Project\ntags: [tagged]\n---\nOverride body.\n')

  const dbFile = path.join(root, 'test.sqlite')
  initDb(dbFile)

  const result = importMarkdownFolder(vault)
  assert(result.imported === 5, `imports 5 notes (got ${result.imported})`)
  assert(result.skipped === 1, `skips 1 empty file (got ${result.skipped})`)
  assert(result.errors.length === 0, 'no errors for a clean tree')

  const items = listItems().filter((it) => result.itemIds.includes(it.id))
  const byTitle = new Map(items.map((it) => [it.title, it]))
  assert(items.length === 5, 'database has 5 imported notes')

  const welcome = byTitle.get('Welcome')
  assert(welcome?.para === 'areas' && welcome?.kind === 'guide', 'welcome keeps para/kind')
  assert(welcome?.project === 'start', 'welcome project from tag')
  assert(welcome?.body === 'Hello there.', 'welcome body wikilink-normalized')

  const plain = byTitle.get('Plain note')
  assert(plain?.project === 'Vault', 'plain note project = folder name')
  assert(plain?.body === 'Some body with a link.', 'plain body wikilink-normalized')

  const nested = byTitle.get('nested')
  assert(nested?.project === 'areas', 'nested note project = subfolder name')

  const tagged = byTitle.get('Trip')
  assert(tagged?.project === 'travel', 'tagged note project = first list tag')

  const override = byTitle.get('override')
  assert(override?.project === 'My Project', 'explicit project wins over tags')

  closeDb()
  fs.rmSync(root, { recursive: true, force: true })

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main()
