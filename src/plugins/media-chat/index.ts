import type { VaultPlugin } from '../types'
import { MediaChatView } from './MediaChatView'

export const mediaChatPlugin: VaultPlugin = {
  id: 'media-chat',
  name: 'Media chat',
  description:
    'Chat with video/audio: captions become vault notes, Ask stays grounded with itm_ citations, citations seek the player.',
  icon: 'movie',
  render: MediaChatView,
}
