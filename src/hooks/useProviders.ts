import { useCallback, useEffect, useState } from 'react'
import type { LlmStatus, ProviderConfig, ProviderPresetInfo } from '../../electron/types'
import { PLUGINS_CHANGED_EVENT, usePluginContributions } from '../plugins/contrib'

/** Owns LLM/provider status, provider dialogs, and plugin enable/disable state. */
export function useProviders() {
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null)
  const [llmChecking, setLlmChecking] = useState(false)
  const [providerPresets, setProviderPresets] = useState<ProviderPresetInfo[]>([])
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | null>(null)
  const [providerInitialPreset, setProviderInitialPreset] = useState<string | undefined>(undefined)
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)
  const [smallHintDismissed, setSmallHintDismissed] = useState(false)
  const [disabledPlugins, setDisabledPlugins] = useState<string[]>([])
  const pluginContribs = usePluginContributions()

  const refreshLlm = useCallback(async () => {
    if (!window.lkv?.llm) return
    try {
      const status = await window.lkv.llm.status()
      setLlmStatus(status)
    } catch {
      setLlmStatus({
        selected: 'auto',
        active: null,
        message: 'AI offline — search still works',
        providers: [],
        needsSetup: false,
        recommendedLocalModel: {
          name: 'qwen3:8b',
          command: 'ollama pull qwen3:8b',
          why: 'Small (~5 GB) and good at following citation rules.',
        },
      })
    }
  }, [])

  /** Manual re-check (first-run card / provider panel) with a visible busy state. */
  const recheckLlm = useCallback(async () => {
    setLlmChecking(true)
    try {
      await refreshLlm()
      if (window.lkv?.providers) {
        const r = await window.lkv.providers.list()
        setProviderPresets(r.presets)
      }
    } finally {
      setLlmChecking(false)
    }
  }, [refreshLlm])

  const refreshPluginState = useCallback(async () => {
    if (!window.lkv?.plugins) return
    try {
      const r = await window.lkv.plugins.list()
      setDisabledPlugins(r.disabled)
      const pr = await window.lkv.providers.list()
      setProviderPresets(pr.presets)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void refreshPluginState()
    const onChange = () => {
      void refreshPluginState()
      void refreshLlm()
    }
    window.addEventListener(PLUGINS_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(PLUGINS_CHANGED_EVENT, onChange)
  }, [refreshPluginState, refreshLlm])

  const openAddProvider = (presetId?: string) => {
    setEditingProvider(null)
    setProviderInitialPreset(presetId)
    setProviderDialogOpen(true)
  }

  return {
    llmStatus,
    llmChecking,
    providerPresets,
    providerDialogOpen,
    setProviderDialogOpen,
    editingProvider,
    setEditingProvider,
    providerInitialPreset,
    aiSettingsOpen,
    setAiSettingsOpen,
    smallHintDismissed,
    setSmallHintDismissed,
    disabledPlugins,
    pluginContribs,
    refreshLlm,
    recheckLlm,
    refreshPluginState,
    openAddProvider,
  }
}
