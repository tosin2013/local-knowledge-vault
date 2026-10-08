import { describe, expect, it } from 'vitest'
import {
  LEGACY_STUDY_PLUGIN_IDS,
  STUDY_PROJECT_KEY,
  STUDY_SECTIONS,
  legacyStudySection,
  loadStudyProject,
  saveStudyProject,
} from '../../src/features/study/sections'

describe('Study tab sections (#260)', () => {
  it('lists Study home first, then the three sections (#262)', () => {
    expect(STUDY_SECTIONS.map((s) => s.label)).toEqual(['Home', 'Review due notes', 'Quiz me on…', 'Import practice test'])
  })

  it('remembers the Study project in localStorage (#262)', () => {
    expect(loadStudyProject()).toBe('')
    saveStudyProject('Biology')
    expect(localStorage.getItem(STUDY_PROJECT_KEY)).toBe('Biology')
    expect(loadStudyProject()).toBe('Biology')
    saveStudyProject('')
    expect(localStorage.getItem(STUDY_PROJECT_KEY)).toBeNull()
  })

  it('maps the former add-on ids onto their Study section', () => {
    expect(legacyStudySection('review')).toBe('review')
    expect(legacyStudySection('study')).toBe('quiz')
    expect(legacyStudySection('test-to-notes')).toBe('import')
    expect(Object.keys(LEGACY_STUDY_PLUGIN_IDS).sort()).toEqual(['review', 'study', 'test-to-notes'])
  })

  it('returns null for other ids, empty values and prototype keys', () => {
    for (const id of ['media-chat', 'manage-plugins', 'study-buddy', '', null, undefined, 'toString', '__proto__', 'constructor']) {
      expect(legacyStudySection(id)).toBeNull()
    }
  })
})
