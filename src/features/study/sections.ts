/**
 * Study tab sections (#260). Study, Review and Test to notes used to be add-on
 * panels with plugin ids `study`, `review` and `test-to-notes`; they now live
 * in the top-level Study tab. These helpers map an old panel id onto the
 * matching Study section so stale ids (old menu entries, saved disabled-plugin
 * lists) open the Study tab instead of an "Unknown plugin" warning.
 */
export type StudySection = 'home' | 'review' | 'quiz' | 'import'

export const STUDY_SECTIONS: { id: StudySection; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'review', label: 'Study session' },
  { id: 'quiz', label: 'Quiz me on…' },
  { id: 'import', label: 'Import practice test' },
]

/** Former add-on panel ids → Study tab section. */
export const LEGACY_STUDY_PLUGIN_IDS: Readonly<Record<string, StudySection>> = Object.freeze({
  review: 'review',
  study: 'quiz',
  'test-to-notes': 'import',
})

/** The Study section a former add-on id maps to, or null for any other id. */
export function legacyStudySection(id: string | null | undefined): StudySection | null {
  if (!id || !Object.prototype.hasOwnProperty.call(LEGACY_STUDY_PLUGIN_IDS, id)) return null
  return LEGACY_STUDY_PLUGIN_IDS[id]
}

/** localStorage key for the Study project picker, shared by every section (#262). */
export const STUDY_PROJECT_KEY = 'lkv.study.project'

export function loadStudyProject(): string {
  try {
    return window.localStorage?.getItem(STUDY_PROJECT_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveStudyProject(project: string): void {
  try {
    if (project) window.localStorage?.setItem(STUDY_PROJECT_KEY, project)
    else window.localStorage?.removeItem(STUDY_PROJECT_KEY)
  } catch {
    /* storage unavailable: the choice lasts for this session only */
  }
}
