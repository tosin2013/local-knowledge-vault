/**
 * Study tab sections (#260). Study, Review and Test to notes used to be add-on
 * panels with plugin ids `study`, `review` and `test-to-notes`; they now live
 * in the top-level Study tab. These helpers map an old panel id onto the
 * matching Study section so stale ids (old menu entries, saved disabled-plugin
 * lists) open the Study tab instead of an "Unknown plugin" warning.
 */
export type StudySection = 'review' | 'quiz' | 'import'

export const STUDY_SECTIONS: { id: StudySection; label: string }[] = [
  { id: 'review', label: 'Review due notes' },
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
