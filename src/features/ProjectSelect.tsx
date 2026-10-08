import { useEffect, useState } from 'react'
import { FormControl, InputLabel, MenuItem, Select } from '@mui/material'
import type { ProjectSummary } from '../../electron/types'

export interface ProjectSelectProps {
  /** Currently selected project ('' means "all projects"). */
  value: string
  onChange: (project: string) => void
  label?: string
  size?: 'small' | 'medium'
  /** Label for the '' option. */
  allLabel?: string
  /** Called with the loaded project list (e.g. for empty states). */
  onProjectsLoaded?: (projects: ProjectSummary[]) => void
}

/**
 * A project picker shared by Study, Review and Test-to-notes. Loads the project
 * list from the main process once and offers an "All projects" default.
 *
 * The '' option keeps its label visible when selected (#262: it used to render
 * blank because MUI hides an empty value unless `displayEmpty` is set). A saved
 * selection that no longer exists (renamed or deleted) falls back to all
 * projects once the list has loaded.
 */
export function ProjectSelect({
  value,
  onChange,
  label = 'Project',
  size = 'small',
  allLabel = 'All projects',
  onProjectsLoaded,
}: ProjectSelectProps) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)

  useEffect(() => {
    let alive = true
    const list = window.lkv?.projects?.list
    if (!list) return
    list()
      .then((p) => {
        if (!alive) return
        setProjects(p ?? [])
        onProjectsLoaded?.(p ?? [])
      })
      .catch(() => {
        /* a failed load just leaves the picker at "All projects" */
      })
    return () => {
      alive = false
    }
    // Load once; onProjectsLoaded is a notification, not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const known = projects ?? []
  const stale = projects !== null && value !== '' && !known.some((p) => p.name === value)
  useEffect(() => {
    if (stale) onChange('')
  }, [stale, onChange])

  // Until the list loads (or when stale) render the value as all projects so
  // MUI never sees an out-of-range value.
  const shown = value && known.some((p) => p.name === value) ? value : ''

  return (
    <FormControl size={size} sx={{ minWidth: 180 }}>
      <InputLabel id="project-select-label" shrink>
        {label}
      </InputLabel>
      <Select
        labelId="project-select-label"
        label={label}
        value={shown}
        displayEmpty
        notched
        renderValue={(v) => (v ? String(v) : allLabel)}
        onChange={(e) => onChange(String(e.target.value))}
        aria-label={label}
      >
        <MenuItem value="">{allLabel}</MenuItem>
        {known.map((p) => (
          <MenuItem key={p.name} value={p.name}>
            {p.name}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}
