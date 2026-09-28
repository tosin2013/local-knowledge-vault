import { useEffect, useMemo, useState } from 'react'
import { createM3Theme } from '../theme/m3Theme'
import {
  applyTheme,
  loadTheme,
  loadUiMode,
  THEME_KEY,
  UI_MODE_KEY,
  type ThemeMode,
  type UiMode,
} from '../domain'

/** Owns the Simple/Advanced mode and the light/dark theme, both persisted to localStorage. */
export function useUi() {
  const [uiMode, setUiMode] = useState<UiMode>(() => loadUiMode())
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme())

  const advanced = uiMode === 'advanced'

  const setUiModePersist = (next: UiMode) => {
    setUiMode(next)
    try {
      localStorage.setItem(UI_MODE_KEY, next)
    } catch {
      /* ignore */
    }
  }

  const setThemePersist = (next: ThemeMode) => {
    setTheme(next)
    applyTheme(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const muiTheme = useMemo(
    () => createM3Theme(theme === 'blink-light' ? 'light' : 'dark'),
    [theme],
  )

  return { uiMode, advanced, setUiModePersist, theme, setThemePersist, muiTheme }
}
