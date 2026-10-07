import type { VaultPlugin } from '../types'
import { ReviewView } from './ReviewView'

export const reviewPlugin: VaultPlugin = {
  id: 'review',
  name: 'Review',
  description:
    'Review notes on a spaced schedule: see what is due, try to recall it, then reveal the note as feedback and rate how it went.',
  icon: 'event_repeat',
  render: ReviewView,
}
