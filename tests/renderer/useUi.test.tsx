import { describe, expect, it, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useUi } from '../../src/hooks/useUi'
import { THEME_KEY, UI_MODE_KEY } from '../../src/domain'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-color-scheme')
})

describe('useUi', () => {
  it('defaults to simple mode and dark theme', () => {
    const { result } = renderHook(() => useUi())
    expect(result.current.advanced).toBe(false)
    expect(result.current.uiMode).toBe('simple')
    expect(result.current.theme).toBe('blink')
  })

  it('loads advanced mode from localStorage', () => {
    localStorage.setItem(UI_MODE_KEY, 'advanced')
    const { result } = renderHook(() => useUi())
    expect(result.current.advanced).toBe(true)
  })

  it('persists ui mode', () => {
    const { result } = renderHook(() => useUi())
    act(() => result.current.setUiModePersist('advanced'))
    expect(result.current.advanced).toBe(true)
    expect(localStorage.getItem(UI_MODE_KEY)).toBe('advanced')
  })

  it('persists theme and applies it to the document', () => {
    const { result } = renderHook(() => useUi())
    act(() => result.current.setThemePersist('blink-light'))
    expect(result.current.theme).toBe('blink-light')
    expect(localStorage.getItem(THEME_KEY)).toBe('blink-light')
    expect(document.documentElement.getAttribute('data-color-scheme')).toBe('light')
  })

  it('exposes a MUI theme', () => {
    const { result } = renderHook(() => useUi())
    expect(result.current.muiTheme).toBeTruthy()
    expect(result.current.muiTheme.palette).toBeTruthy()
  })
})
