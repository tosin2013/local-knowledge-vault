import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { VoiceSettings, VoiceStatus } from '../../../electron/types'

/**
 * Shared voice settings and speech status (#413), so a change in Settings shows
 * up in Study and Ask at once. Loaded on first use; the status is re-checked on
 * demand (after a download, or when Settings opens).
 */
export interface VoiceState {
  loaded: boolean
  settings: VoiceSettings
  status: VoiceStatus | null
  checking: boolean
}

export const VOICE_DEFAULTS: VoiceSettings = {
  enabled: false,
  spokenReplies: true,
  providerId: 'ollama',
  sttModel: 'lfm3-audio',
  ttsModel: 'phonon',
  output: 'provider',
  voice: '',
}

let state: VoiceState = { loaded: false, settings: VOICE_DEFAULTS, status: null, checking: false }
const listeners = new Set<() => void>()
let loading: Promise<void> | null = null

function emit(next: Partial<VoiceState>): void {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Tests: forget the cached settings. */
export function resetVoiceStore(): void {
  state = { loaded: false, settings: VOICE_DEFAULTS, status: null, checking: false }
  loading = null
}

export async function refreshVoiceStatus(): Promise<VoiceStatus | null> {
  const api = window.lkv?.voice
  if (!api?.status) return null
  emit({ checking: true })
  try {
    const status = await api.status()
    emit({ status, checking: false })
    return status
  } catch {
    emit({ checking: false })
    return null
  }
}

export function loadVoice(): Promise<void> {
  const api = window.lkv?.voice
  if (!api?.getSettings) return Promise.resolve()
  if (!loading) {
    loading = (async () => {
      try {
        emit({ settings: await api.getSettings(), loaded: true })
      } catch {
        emit({ loaded: true })
      }
      if (state.settings.enabled) await refreshVoiceStatus()
    })()
  }
  return loading
}

export async function updateVoiceSettings(patch: Partial<VoiceSettings>): Promise<VoiceSettings> {
  const api = window.lkv?.voice
  const optimistic = { ...state.settings, ...patch }
  emit({ settings: optimistic })
  if (!api?.setSettings) return optimistic
  try {
    const saved = await api.setSettings(patch)
    emit({ settings: saved })
    const needsStatus = 'providerId' in patch || 'sttModel' in patch || 'ttsModel' in patch || (patch.enabled && !state.status)
    if (needsStatus) await refreshVoiceStatus()
    return saved
  } catch {
    return state.settings
  }
}

export function useVoice() {
  const snap = useSyncExternalStore(subscribe, () => state)
  useEffect(() => {
    void loadVoice()
  }, [])
  const update = useCallback((patch: Partial<VoiceSettings>) => updateVoiceSettings(patch), [])
  const refresh = useCallback(() => refreshVoiceStatus(), [])
  return {
    ...snap,
    /** Voice is available in this build and turned on. */
    enabled: !!window.lkv?.voice && snap.settings.enabled,
    update,
    refresh,
  }
}
