import { useCallback, useEffect, useState } from 'react'
import type { Prompt } from '../../electron/types'
import type { PromptDraft } from '../features/PromptsView'

export interface UsePromptsDeps {
  setBusy: (busy: boolean) => void
  advanced: boolean
  setMode: (mode: 'search' | 'chat' | 'prompts') => void
  /** Re-pick the active profile after the currently-selected prompt is deleted. */
  onPromptDeleted: (deletedId: string) => void
}

/** Owns the personality (prompt) list and editor. */
export function usePrompts(deps: UsePromptsDeps) {
  const { setBusy, advanced, setMode, onPromptDeleted } = deps

  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null)
  const [promptDraft, setPromptDraft] = useState<PromptDraft>({ name: '', body: '', description: '' })
  const [promptDirty, setPromptDirty] = useState(false)
  const [promptBodyOpen, setPromptBodyOpen] = useState(false)
  const [shareNotice, setShareNotice] = useState('')

  const refreshPrompts = useCallback(async () => {
    if (!window.lkv) return
    const list = await window.lkv.prompts.list()
    setPrompts(list)
  }, [])

  useEffect(() => {
    if (advanced) setPromptBodyOpen(true)
  }, [advanced])

  const onNewPrompt = () => {
    setEditingPrompt(null)
    setPromptDraft({ name: '', body: '', description: '' })
    setPromptDirty(false)
    setPromptBodyOpen(true)
    setMode('prompts')
  }

  const onSelectPrompt = (p: Prompt) => {
    setEditingPrompt(p)
    setPromptDraft({
      name: p.name,
      body: p.body,
      description: p.description ?? '',
    })
    setPromptDirty(false)
    setPromptBodyOpen(advanced)
  }

  const onSavePrompt = async () => {
    if (!window.lkv || !promptDraft.name.trim() || !promptDraft.body.trim()) return
    setBusy(true)
    try {
      if (editingPrompt) {
        const updated = await window.lkv.prompts.update(editingPrompt.id, {
          name: promptDraft.name,
          body: promptDraft.body,
          description: promptDraft.description || null,
        })
        setEditingPrompt(updated)
      } else {
        const created = await window.lkv.prompts.create({
          name: promptDraft.name,
          body: promptDraft.body,
          description: promptDraft.description || null,
        })
        setEditingPrompt(created)
      }
      setPromptDirty(false)
      await refreshPrompts()
    } finally {
      setBusy(false)
    }
  }

  const onDeletePrompt = async () => {
    if (!window.lkv || !editingPrompt) return
    if (!confirm(`Delete personality “${editingPrompt.name}”?`)) return
    const deletedId = editingPrompt.id
    await window.lkv.prompts.delete(deletedId)
    onPromptDeleted(deletedId)
    setEditingPrompt(null)
    setPromptDraft({ name: '', body: '', description: '' })
    setPromptDirty(false)
    setPromptBodyOpen(false)
    await refreshPrompts()
  }

  const flashNotice = (text: string) => {
    setShareNotice(text)
    window.setTimeout(() => setShareNotice(''), 4000)
  }

  /** Export the selected personality as a versioned JSON pack (#164). */
  const onExportPrompt = async (target: 'file' | 'clipboard') => {
    if (!window.lkv || !editingPrompt) return
    const res = await window.lkv.prompts.export({ id: editingPrompt.id, target })
    if (res.error) {
      flashNotice(res.error)
      return
    }
    if (res.canceled) return
    flashNotice(target === 'clipboard' ? 'Copied JSON' : 'Exported personality')
  }

  /** Import a personality from a JSON file and select it (#164). */
  const onImportPrompt = async () => {
    if (!window.lkv) return
    const res = await window.lkv.prompts.import()
    if (res.error) {
      flashNotice(res.error)
      return
    }
    if (res.canceled || !res.prompt) return
    setEditingPrompt(res.prompt)
    setPromptDraft({
      name: res.prompt.name,
      body: res.prompt.body,
      description: res.prompt.description ?? '',
    })
    setPromptDirty(false)
    setPromptBodyOpen(true)
    setMode('prompts')
    await refreshPrompts()
    flashNotice(`Imported “${res.prompt.name}”`)
  }

  return {
    prompts,
    setPrompts,
    editingPrompt,
    setEditingPrompt,
    promptDraft,
    setPromptDraft,
    promptDirty,
    setPromptDirty,
    promptBodyOpen,
    setPromptBodyOpen,
    refreshPrompts,
    onNewPrompt,
    onSelectPrompt,
    onSavePrompt,
    onDeletePrompt,
    onExportPrompt,
    onImportPrompt,
    shareNotice,
  }
}
