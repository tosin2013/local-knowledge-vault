import { useCallback, useState } from 'react'

/** Optional controlled project for a Study section (#262). */
export interface StudyProjectProps {
  /** The Study project shared across sections ('' = all projects). */
  project?: string
  onProjectChange?: (project: string) => void
}

/**
 * The section's project: the shared Study project when the Study tab passes
 * one in, otherwise local state (a section rendered on its own, e.g. in tests).
 */
export function useStudyProject(
  project: string | undefined,
  onProjectChange: ((project: string) => void) | undefined,
): [string, (project: string) => void] {
  const [local, setLocal] = useState('')
  const controlled = project !== undefined
  const set = useCallback(
    (next: string) => {
      if (!controlled) setLocal(next)
      onProjectChange?.(next)
    },
    [controlled, onProjectChange],
  )
  return [controlled ? project : local, set]
}
