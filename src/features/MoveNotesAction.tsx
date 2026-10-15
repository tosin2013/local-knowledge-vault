import { useState } from 'react'
import { Button, Stack } from '@mui/material'
import { ProjectSelect } from './ProjectSelect'

export interface MoveNotesActionProps {
  /** The notes this action would move (one `items:update` per id, #276). */
  itemIds: string[]
  /** Called after every id has been re-filed into the chosen project. */
  onMoved: (project: string, count: number) => void
}

/**
 * "Move N notes to <project>" — the affordance behind the post-import toast
 * and the media ingest status (#276). The learner picks the target project,
 * the move loops `items.update` per id (the same shape as the rail's bulk
 * trash), and the caller decides what refresh + confirmation to show.
 */
export function MoveNotesAction({ itemIds, onMoved }: MoveNotesActionProps) {
  const [target, setTarget] = useState('')
  const [moving, setMoving] = useState(false)

  const move = async () => {
    if (!target || moving || itemIds.length === 0) return
    setMoving(true)
    try {
      for (const id of itemIds) {
        await window.lkv?.items?.update(id, { project: target })
      }
      onMoved(target, itemIds.length)
    } finally {
      setMoving(false)
    }
  }

  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 1 }}>
      <ProjectSelect
        value={target}
        onChange={setTarget}
        label="Move to project"
        allLabel="Choose project…"
      />
      <Button
        size="small"
        variant="outlined"
        disabled={!target || moving || itemIds.length === 0}
        onClick={() => void move()}
      >
        {moving ? 'Moving…' : `Move ${itemIds.length} note${itemIds.length === 1 ? '' : 's'}`}
      </Button>
    </Stack>
  )
}
