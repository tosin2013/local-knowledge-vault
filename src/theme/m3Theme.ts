import { createTheme, type ThemeOptions } from '@mui/material/styles'

/**
 * Material Design 3–aligned theme for Vault.
 * Seed: teal/cyan close to prior Blink primary (oklch 60% 0.126 221 ≈ #0097A7).
 * localStorage keys remain `blink` (dark) | `blink-light` (light).
 */
export const VAULT_SEED = '#0097A7'

const shape = {
  borderRadius: 16,
}

const typography = {
  fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  fontSize: 14,
  h6: { fontWeight: 600, letterSpacing: 0.15 },
  subtitle2: { fontWeight: 600 },
  button: { textTransform: 'none' as const, fontWeight: 600 },
}

const sharedComponents: ThemeOptions['components'] = {
  MuiButton: {
    defaultProps: { disableElevation: true },
    styleOverrides: {
      root: { borderRadius: 999, paddingInline: 16 },
      sizeSmall: { borderRadius: 999, paddingInline: 12 },
      contained: { borderRadius: 999 },
      outlined: { borderRadius: 999 },
      text: { borderRadius: 999 },
    },
  },
  MuiIconButton: {
    styleOverrides: {
      root: { borderRadius: 12 },
    },
  },
  MuiChip: {
    styleOverrides: {
      root: { borderRadius: 8 },
    },
  },
  MuiPaper: {
    defaultProps: { elevation: 0 },
    styleOverrides: {
      root: { backgroundImage: 'none' },
      rounded: { borderRadius: 16 },
    },
  },
  MuiCard: {
    defaultProps: { elevation: 0 },
    styleOverrides: {
      root: { borderRadius: 20 },
    },
  },
  MuiTextField: {
    defaultProps: { size: 'small', variant: 'outlined' },
  },
  MuiOutlinedInput: {
    styleOverrides: {
      root: { borderRadius: 12 },
    },
  },
  MuiFilledInput: {
    styleOverrides: {
      root: { borderRadius: '12px 12px 0 0' },
    },
  },
  MuiSelect: {
    defaultProps: { size: 'small' },
  },
  MuiToggleButton: {
    styleOverrides: {
      root: {
        borderRadius: 999,
        textTransform: 'none',
        px: 2,
        border: 'none',
        '&.Mui-selected': { fontWeight: 600 },
      },
    },
  },
  MuiToggleButtonGroup: {
    styleOverrides: {
      root: { borderRadius: 999, gap: 2, padding: 2 },
      grouped: { border: 'none !important', borderRadius: '999px !important' },
    },
  },
  MuiAppBar: {
    defaultProps: { elevation: 0, color: 'transparent' },
  },
  MuiFab: {
    styleOverrides: {
      root: { borderRadius: 16 },
    },
  },
  MuiListItemButton: {
    styleOverrides: {
      root: { borderRadius: 12 },
    },
  },
  MuiAlert: {
    styleOverrides: {
      root: { borderRadius: 12 },
    },
  },
  MuiSwitch: {
    defaultProps: { size: 'small' },
  },
  MuiDialog: {
    styleOverrides: {
      paper: { borderRadius: 28 },
    },
  },
}

function darkPalette(): ThemeOptions['palette'] {
  return {
    mode: 'dark',
    primary: {
      main: VAULT_SEED,
      light: '#4DB6C4',
      dark: '#006974',
      contrastText: '#00363D',
    },
    secondary: {
      main: '#B0BEC5',
      contrastText: '#1C1B1F',
    },
    error: { main: '#F2B8B5', contrastText: '#601410' },
    background: {
      default: '#0F1419',
      paper: '#1A2228',
    },
    text: {
      primary: '#E1E3E4',
      secondary: '#A0A8AD',
    },
    divider: 'rgba(225, 227, 228, 0.12)',
    success: { main: '#81C784' },
    warning: { main: '#FFB74D' },
  }
}

function lightPalette(): ThemeOptions['palette'] {
  return {
    mode: 'light',
    primary: {
      main: '#007C8A',
      light: '#4DB6C4',
      dark: '#004F58',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#546E7A',
      contrastText: '#FFFFFF',
    },
    error: { main: '#B3261E' },
    background: {
      default: '#F7F9FA',
      paper: '#FFFFFF',
    },
    text: {
      primary: '#1A1C1E',
      secondary: '#5C6368',
    },
    divider: 'rgba(26, 28, 30, 0.12)',
    success: { main: '#2E7D32' },
    warning: { main: '#ED6C02' },
  }
}

export type VaultColorScheme = 'dark' | 'light'

/** Map legacy `lkv.theme` values to M3 color schemes. */
export function schemeFromStored(stored: string | null): VaultColorScheme {
  return stored === 'blink-light' ? 'light' : 'dark'
}

export function storedFromScheme(scheme: VaultColorScheme): 'blink' | 'blink-light' {
  return scheme === 'light' ? 'blink-light' : 'blink'
}

export function createM3Theme(scheme: VaultColorScheme) {
  return createTheme({
    palette: scheme === 'dark' ? darkPalette() : lightPalette(),
    shape,
    typography,
    components: sharedComponents,
    cssVariables: {
      cssVarPrefix: 'm3',
    },
  })
}
