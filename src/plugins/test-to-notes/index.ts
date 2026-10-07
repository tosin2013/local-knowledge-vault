import type { VaultPlugin } from '../types'
import { TestToNotesView } from './TestToNotesView'

export const testToNotesPlugin: VaultPlugin = {
  id: 'test-to-notes',
  name: 'Test to notes',
  description:
    'Paste practice-test results, see what you missed, and turn each wrong answer into a grounded corrective note you can save.',
  icon: 'quiz',
  render: TestToNotesView,
}
