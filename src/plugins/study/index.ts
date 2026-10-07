import type { VaultPlugin } from '../types'
import { StudyView } from './StudyView'

export const studyPlugin: VaultPlugin = {
  id: 'study',
  name: 'Study',
  description:
    'Recall first, then reveal the grounded, cited answer as feedback. Rate your confidence and self-grade so you can see how well calibrated you are.',
  icon: 'school',
  render: StudyView,
}
