import type { VaultPlugin } from '../types'
import { MediaPersonasView } from './MediaPersonasView'

export const mediaPersonasPlugin: VaultPlugin = {
  id: 'media-personas',
  name: 'Media voices',
  description:
    'Reusable Media voice packs (any video). Install / Add voice → Media chat chips. Optional Ask profiles are advanced-only.',
  icon: 'record_voice_over',
  render: MediaPersonasView,
}

export { MEDIA_PERSONAS, MEDIA_HARD_RULES } from './personas'
