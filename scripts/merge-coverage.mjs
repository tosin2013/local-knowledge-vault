// Merges the two coverage reports CI collects:
//   - coverage/lcov.info         (c8 over the Electron smoke tests → electron/**)
//   - coverage/renderer/lcov.info (vitest over the renderer tests → src/**)
// into a single coverage/lcov.info that Codecov uploads. The two suites cover
// disjoint source trees, so concatenation is safe (no duplicate SF records).
import { readFileSync, writeFileSync } from 'node:fs'

const electron = readFileSync('coverage/lcov.info', 'utf8')
const renderer = readFileSync('coverage/renderer/lcov.info', 'utf8')

const count = (s) => (s.match(/^end_of_record$/gm) ?? []).length
const merged = `${electron.trimEnd()}\n${renderer.trimEnd()}\n`

writeFileSync('coverage/lcov.info', merged)
console.log(
  `Merged coverage: ${count(electron)} electron record(s) + ${count(renderer)} renderer record(s)`,
)
