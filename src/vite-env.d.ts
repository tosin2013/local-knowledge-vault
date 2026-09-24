/// <reference types="vite/client" />

import type { LkvApi } from '../electron/preload'

declare global {
  interface Window {
    lkv: LkvApi
  }
}

export {}
