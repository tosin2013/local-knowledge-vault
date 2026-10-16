import { useEffect, useState } from 'react'
import { FormControlLabel, Switch, Tooltip, Typography } from '@mui/material'

export interface MultipleChoiceSettingProps {
  /** The Study project ('' = all projects: the setting is per project, so it is hidden). */
  project: string
}

/**
 * Per-project "Ask multiple-choice questions as multiple choice" (#324), on by
 * default. Off: imported multiple-choice items are asked as free recall like
 * every other card.
 */
export function MultipleChoiceSetting({ project }: MultipleChoiceSettingProps) {
  const [on, setOn] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    setOn(true)
    const get = window.lkv?.projects?.getSettings
    if (!project || !get) return
    get(project)
      .then((s) => {
        if (alive) setOn(s?.multipleChoice !== false)
      })
      .catch(() => {
        /* no settings yet: default on */
      })
    return () => {
      alive = false
    }
  }, [project])

  const set = window.lkv?.projects?.setMultipleChoice
  if (!project || !set) return null

  const change = async (value: boolean) => {
    setBusy(true)
    setOn(value)
    try {
      const res = await set(project, value)
      setOn(res?.multipleChoice !== false)
    } catch {
      setOn(!value)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Tooltip title="Imported practice-test questions with options are asked with their options, the way the exam asks them. After two right answers in a row a card is asked from memory instead.">
      <FormControlLabel
        data-testid="mc-setting"
        control={
          <Switch
            size="small"
            checked={on}
            disabled={busy}
            onChange={(e) => void change(e.target.checked)}
            inputProps={{ 'aria-label': 'Ask multiple-choice questions as multiple choice' }}
          />
        }
        label={<Typography variant="body2">Ask multiple-choice questions as multiple choice</Typography>}
      />
    </Tooltip>
  )
}
