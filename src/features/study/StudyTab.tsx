import { useCallback, useState } from 'react'
import { Box, Stack, Tab, Tabs, Typography } from '@mui/material'
import SchoolIcon from '@mui/icons-material/School'
import type { Item } from '../../../electron/types'
import { ReviewView } from './ReviewView'
import { StudyView } from './StudyView'
import { TestToNotesView } from './TestToNotesView'
import { StudyHome } from './StudyHome'
import { STUDY_SECTIONS, loadStudyProject, saveStudyProject, type StudySection } from './sections'

export interface StudyTabProps {
  section: StudySection
  onSection: (section: StudySection) => void
  onOpenNote: (id: string) => void
  onNewDraft: (fields: Partial<Item>) => void
}

/**
 * The top-level Study tab (#260): exam prep from your own notes. Study home
 * (#262) comes first; Review, Quiz me on… and Import practice test follow.
 * One project picker is shared by every section and remembered across
 * section and tab switches (#262).
 */
export function StudyTab({ section, onSection, onOpenNote, onNewDraft }: StudyTabProps) {
  const [project, setProjectState] = useState(loadStudyProject)
  const setProject = useCallback((next: string) => {
    setProjectState(next)
    saveStudyProject(next)
  }, [])
  const viewProps = { onOpenNote, onNewDraft, project, onProjectChange: setProject }
  return (
    <Box
      data-testid="study-tab"
      sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, pt: 0.5 }}>
        <SchoolIcon color="primary" fontSize="small" />
        <Typography variant="h6" component="h2" fontWeight={600}>
          Study
        </Typography>
        <Typography variant="body2" color="text.secondary" noWrap>
          Exam prep from your own notes
        </Typography>
      </Stack>
      <Tabs
        value={section}
        onChange={(_e, v: StudySection) => onSection(v)}
        aria-label="Study sections"
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ px: 1, borderBottom: 1, borderColor: 'divider', minHeight: 40 }}
      >
        {STUDY_SECTIONS.map((s) => (
          <Tab
            key={s.id}
            value={s.id}
            label={s.label}
            id={`study-tab-${s.id}`}
            aria-controls={`study-panel-${s.id}`}
            sx={{ minHeight: 40, textTransform: 'none' }}
          />
        ))}
      </Tabs>
      <Box
        role="tabpanel"
        id={`study-panel-${section}`}
        aria-labelledby={`study-tab-${section}`}
        sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        {section === 'home' && (
          <StudyHome project={project} onProjectChange={setProject} onStartReview={() => onSection('review')} />
        )}
        {section === 'review' && <ReviewView {...viewProps} />}
        {section === 'quiz' && <StudyView {...viewProps} />}
        {section === 'import' && <TestToNotesView {...viewProps} />}
      </Box>
    </Box>
  )
}
