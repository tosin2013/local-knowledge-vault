import { describe, expect, it, beforeEach } from 'vitest'
import {
  askEmptyStateCopy,
  applyTheme,
  BUILTIN_PROFILES,
  emptyFilters,
  findGroundedDefaultPrompt,
  GORGIAS_PROJECT,
  isBuiltinProfileId,
  isGorgiasReaderPrompt,
  isValidHttpUrl,
  KIND_OPTIONS,
  LAST_PROFILE_KEY,
  loadLastProfile,
  loadTheme,
  loadUiMode,
  makeNewDraftItem,
  matchProfileId,
  NEW_DRAFT_ID,
  PARA_OPTIONS,
  paraLabel,
  parseCitations,
  personalityDisplayName,
  resolveProfilePromptId,
  saveLastProfile,
  STATUS_OPTIONS,
  THEME_KEY,
  titleFromFirstQuestion,
  UI_MODE_KEY,
} from '../../src/domain'
import { makeProfile, makePrompt } from './lkv'

beforeEach(() => {
  localStorage.clear()
})

describe('constants', () => {
  it('exposes PARA, kind and status option lists', () => {
    expect(PARA_OPTIONS).toEqual(['', 'projects', 'areas', 'resources', 'archives'])
    expect(KIND_OPTIONS).toContain('note')
    expect(STATUS_OPTIONS).toContain('active')
  })

  it('exposes a stable new-draft id', () => {
    expect(NEW_DRAFT_ID).toBe('__draft_new__')
  })
})

describe('paraLabel', () => {
  it('maps known PARA groups', () => {
    expect(paraLabel('projects')).toBe('Projects')
    expect(paraLabel('archives')).toBe('Archive')
  })
  it('falls back to the raw value for unknowns', () => {
    expect(paraLabel('custom')).toBe('custom')
  })
})

describe('emptyFilters', () => {
  it('returns blank filters', () => {
    expect(emptyFilters()).toEqual({ para: '', kind: '', status: '', project: '' })
  })
})

describe('isValidHttpUrl', () => {
  it('accepts http and https', () => {
    expect(isValidHttpUrl('https://example.com')).toBe(true)
    expect(isValidHttpUrl('http://example.com')).toBe(true)
  })
  it('rejects non-http schemes and junk', () => {
    expect(isValidHttpUrl('ftp://example.com')).toBe(false)
    expect(isValidHttpUrl('not a url')).toBe(false)
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false)
  })
})

describe('makeNewDraftItem', () => {
  it('creates an unsaved draft with the sentinel id', () => {
    const d = makeNewDraftItem()
    expect(d.id).toBe(NEW_DRAFT_ID)
    expect(d.para).toBe('resources')
    expect(d.kind).toBe('note')
  })
})

describe('parseCitations', () => {
  it('parses valid JSON arrays', () => {
    expect(parseCitations(JSON.stringify([{ id: 'a', title: 'T' }]))).toEqual([{ id: 'a', title: 'T' }])
  })
  it('returns [] for null, bad JSON, or non-array', () => {
    expect(parseCitations(null)).toEqual([])
    expect(parseCitations('not json')).toEqual([])
    expect(parseCitations(JSON.stringify({ id: 'a' }))).toEqual([])
  })
})

describe('profile helpers', () => {
  it('isBuiltinProfileId recognises builtins only', () => {
    expect(isBuiltinProfileId('grounded-helper')).toBe(true)
    expect(isBuiltinProfileId('gorgias')).toBe(true)
    expect(isBuiltinProfileId('prf_1')).toBe(false)
    expect(isBuiltinProfileId('custom')).toBe(false)
  })

  it('findGroundedDefaultPrompt prefers the named grounded prompts', () => {
    const prompts = [makePrompt('prm_x', 'Other'), makePrompt('prm_g', 'Grounded default')]
    expect(findGroundedDefaultPrompt(prompts)?.id).toBe('prm_g')
  })

  it('isGorgiasReaderPrompt matches by id or name', () => {
    expect(isGorgiasReaderPrompt('prm_56ba1ab41bfe4042', [])).toBe(true)
    expect(isGorgiasReaderPrompt('prm_x', [makePrompt('prm_x', 'Gorgias reader')])).toBe(true)
    expect(isGorgiasReaderPrompt('', [])).toBe(false)
  })

  it('resolveProfilePromptId resolves by promptId or name', () => {
    const prompts = [makePrompt('prm_g', 'Grounded default')]
    const gorgias = BUILTIN_PROFILES.find((p) => p.id === 'gorgias')!
    expect(resolveProfilePromptId(gorgias, prompts)).toBe('prm_56ba1ab41bfe4042')
    const grounded = BUILTIN_PROFILES.find((p) => p.id === 'grounded-helper')!
    expect(resolveProfilePromptId(grounded, prompts)).toBe('prm_g')
  })

  it('personalityDisplayName maps Grounded default to Grounded helper', () => {
    expect(personalityDisplayName(makePrompt('x', 'Grounded default'))).toBe('Grounded helper')
    expect(personalityDisplayName(makePrompt('x', 'Concise'))).toBe('Concise')
  })

  it('matchProfileId returns a builtin id when prompt+project align', () => {
    const prompts = [makePrompt('prm_g', 'Grounded default')]
    expect(matchProfileId('prm_g', '', prompts)).toBe('grounded-helper')
    const gorgias = [makePrompt('prm_56ba1ab41bfe4042', 'Gorgias reader')]
    expect(matchProfileId('prm_56ba1ab41bfe4042', 'Gorgias', gorgias)).toBe('gorgias')
  })

  it('matchProfileId returns a user profile or custom', () => {
    const prompts = [makePrompt('prm_g', 'Grounded default')]
    const profiles = [makeProfile('prf_1', { prompt_id: 'prm_g', project: 'Work' })]
    expect(matchProfileId('prm_g', 'Work', prompts, profiles)).toBe('prf_1')
    expect(matchProfileId('prm_g', 'Other', prompts, profiles)).toBe('custom')
  })
})

describe('titleFromFirstQuestion', () => {
  it('uses the first sentence and truncates', () => {
    expect(titleFromFirstQuestion('What is PARA? Tell me more')).toBe('What is PARA')
    expect(titleFromFirstQuestion('')).toBe('New chat')
  })
  it('truncates long titles', () => {
    const long = 'A'.repeat(100)
    expect(titleFromFirstQuestion(long).length).toBeLessThanOrEqual(48)
  })
})

describe('askEmptyStateCopy', () => {
  it('describes Gorgias mode', () => {
    expect(askEmptyStateCopy('gorgias', [], '', '', []).title).toBe("You're talking with Gorgias")
  })
  it('describes grounded-helper mode', () => {
    expect(askEmptyStateCopy('grounded-helper', [], '', '', []).title).toContain('Ask anything')
  })
  it('describes a user profile', () => {
    const prompts = [makePrompt('prm_g', 'Grounded default')]
    const profiles = [makeProfile('prf_1', { name: 'Work persona', project: 'Work' })]
    const copy = askEmptyStateCopy('prf_1', prompts, 'prm_g', 'Work', profiles)
    expect(copy.title).toBe('Work persona')
    expect(copy.body).toContain('Work')
  })
  it('flags a broken user profile', () => {
    const profiles = [makeProfile('prf_1', { name: 'Work persona', project: 'Work' })]
    const copy = askEmptyStateCopy('prf_1', [], '', 'Work', profiles)
    expect(copy.title).toContain('personality missing')
  })
  it('describes custom', () => {
    const prompts = [makePrompt('prm_g', 'Grounded default')]
    expect(askEmptyStateCopy('custom', prompts, 'prm_g', '', []).title).toBe('Custom · Grounded helper')
  })
})

describe('theme / ui-mode persistence', () => {
  it('loads and persists ui mode', () => {
    localStorage.setItem(UI_MODE_KEY, 'advanced')
    expect(loadUiMode()).toBe('advanced')
    localStorage.setItem(UI_MODE_KEY, 'junk')
    expect(loadUiMode()).toBe('simple')
  })
  it('loads and persists theme', () => {
    localStorage.setItem(THEME_KEY, 'blink-light')
    expect(loadTheme()).toBe('blink-light')
    localStorage.setItem(THEME_KEY, 'blink')
    expect(loadTheme()).toBe('blink')
  })
  it('applyTheme sets the color-scheme attribute', () => {
    applyTheme('blink-light')
    expect(document.documentElement.getAttribute('data-color-scheme')).toBe('light')
    applyTheme('blink')
    expect(document.documentElement.getAttribute('data-color-scheme')).toBe('dark')
  })
})

describe('last-profile persistence', () => {
  it('round-trips a profile state', () => {
    saveLastProfile({ profileId: 'gorgias', promptId: 'prm_x', project: GORGIAS_PROJECT })
    expect(loadLastProfile()).toEqual({ profileId: 'gorgias', promptId: 'prm_x', project: 'Gorgias' })
  })
  it('returns null for missing or malformed data', () => {
    expect(loadLastProfile()).toBeNull()
    localStorage.setItem(LAST_PROFILE_KEY, 'not json')
    expect(loadLastProfile()).toBeNull()
    localStorage.setItem(LAST_PROFILE_KEY, JSON.stringify({ profileId: 123 }))
    expect(loadLastProfile()).toBeNull()
  })
})
