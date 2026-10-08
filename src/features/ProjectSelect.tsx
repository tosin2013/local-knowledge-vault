import { useEffect, useState } from 'react'
import { FormControl, InputLabel, MenuItem, Select } from '@mui/material'
import type { ProjectSummary } from '../../electron/types'

export interface ProjectSelectProps {
  /** Currently selected project ('' means "all projects"). */
  value: string
  onChange: (project: string) => void
  label?: string
  size?: 'small' | 'medium'
}

/**
 * A project picker shared by Study, Review and Test-to-notes. Loads the project
 * list from the main process once and offers an "All projects" default.
 */
export function ProjectSelect({ value, onChange, label = 'Project', size = 'small' }: ProjectSelectProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([])

  useEffect(() => {
    let alive = true
    const list = window.lkv?.projects?.list
    if (!list) return
    list()
      .then((p) => {
        if (alive) setProjects(p ?? [])
      })
      .catch(() => {
        /* a failed load just leaves the picker at "All projects" */
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <FormControl size={size} sx={{ minWidth: 160 }}>
      <InputLabel id="project-select-label">{label}</InputLabel>
      <Select
        labelId="project-select-label"
        label={label}
        value={value}
        onChange={(e) => onChange(String(e.target.value))}
        aria-label={label}
      >
        <MenuItem value="">All projects</MenuItem>
        {projects.map((p) => (
          <MenuItem key={p.name} value={p.name}>
            {p.name}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}
