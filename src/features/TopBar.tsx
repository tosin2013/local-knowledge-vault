import {
  AppBar,
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import LightModeIcon from '@mui/icons-material/LightMode'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import ExtensionIcon from '@mui/icons-material/Extension'
import type { LlmStatus } from '../../electron/types'
import type { Mode, ThemeMode } from '../domain'
import type { VaultPlugin } from '../plugins/types'
import { MANAGE_PLUGINS_ID } from '../plugins/manage'
import type { RefObject } from 'react'

export interface TopBarProps {
  advanced: boolean
  mode: Mode
  activePluginId: string | null
  pluginsMenuAnchor: HTMLElement | null
  visiblePlugins: VaultPlugin[]
  aiStatusText: string
  llmStatus: LlmStatus | null
  aiReady: boolean
  theme: ThemeMode
  searchText: string
  busy: boolean
  searchInputRef?: RefObject<HTMLInputElement | null>
  onSearchText: (v: string) => void
  onRunSearch: () => void
  onAiSettings: () => void
  onRecheck: () => void
  onPersonalities: () => void
  onPluginsMenu: (el: HTMLElement | null) => void
  onSelectPlugin: (id: string) => void
  onAdvanced: (advanced: boolean) => void
  onTheme: () => void
}

export function TopBar(props: TopBarProps) {
  const {
    advanced,
    mode,
    activePluginId,
    pluginsMenuAnchor,
    visiblePlugins,
    aiStatusText,
    llmStatus,
    aiReady,
    theme,
    searchText,
    busy,
    searchInputRef,
    onSearchText,
    onRunSearch,
    onAiSettings,
    onRecheck,
    onPersonalities,
    onPluginsMenu,
    onSelectPlugin,
    onAdvanced,
    onTheme,
  } = props

  return (
    <AppBar position="sticky" sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider', color: 'text.primary' }}>
      <Toolbar variant="dense" sx={{ gap: 1.5, minHeight: 56, px: 1.5 }}>
        <Stack direction="row" alignItems="center" spacing={1.25} sx={{ flexShrink: 0 }}>
          <Box
            className="vault-mark"
            aria-hidden
            sx={{ bgcolor: 'primary.main', color: 'primary.contrastText' }}
          >
            <svg width="22" height="22" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="3.5" y="5" width="21" height="18" rx="3.5" stroke="currentColor" strokeWidth="1.75" />
              <path d="M9 5v18M14 10.5h6.5M14 14.5h5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </Box>
          <Box sx={{ minWidth: 0, lineHeight: 1.15 }}>
            <Typography variant="subtitle1" fontWeight={600} noWrap>
              Vault
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ letterSpacing: 0.4 }}>
              Local knowledge
            </Typography>
          </Box>
        </Stack>

        <Box sx={{ flex: 1, minWidth: 0, px: 1, display: 'flex', justifyContent: 'center' }}>
          <TextField
            fullWidth
            size="small"
            placeholder="Search your notes…"
            value={searchText}
            inputRef={searchInputRef}
            onChange={(e) => onSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) onRunSearch()
            }}
            aria-label="Search notes"
            sx={{ maxWidth: 560, '& .MuiOutlinedInput-root': { borderRadius: 999 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  <Button
                    size="small"
                    variant="contained"
                    onClick={onRunSearch}
                    disabled={busy}
                    sx={{ mr: -0.5, borderRadius: 999 }}
                  >
                    Search
                  </Button>
                </InputAdornment>
              ),
            }}
          />
        </Box>

        <Stack direction="row" alignItems="center" spacing={1} sx={{ flexShrink: 0 }}>
          <Chip
            size="small"
            label={aiStatusText}
            color={llmStatus == null ? 'default' : aiReady ? (llmStatus.active?.local ? 'success' : 'info') : 'warning'}
            variant={llmStatus == null ? 'outlined' : 'filled'}
            title={`${llmStatus?.message ?? 'AI status'} — click for AI providers`}
            onClick={() => {
              onAiSettings()
              onRecheck()
            }}
            sx={{ maxWidth: 280 }}
            data-testid="ai-chip"
          />
          {advanced && (
            <Button
              size="small"
              variant={mode === 'prompts' ? 'contained' : 'outlined'}
              color="primary"
              onClick={onPersonalities}
            >
              Personalities
            </Button>
          )}
          <Button
            size="small"
            variant={activePluginId ? 'contained' : 'outlined'}
            color="primary"
            startIcon={<ExtensionIcon fontSize="small" />}
            onClick={(e) => onPluginsMenu(e.currentTarget)}
            aria-haspopup="true"
            aria-expanded={Boolean(pluginsMenuAnchor)}
          >
            Plugins
          </Button>
          <Menu
            anchorEl={pluginsMenuAnchor}
            open={Boolean(pluginsMenuAnchor)}
            onClose={() => onPluginsMenu(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            {visiblePlugins.map((plug) => (
              <MenuItem
                key={plug.id}
                selected={activePluginId === plug.id}
                onClick={() => onSelectPlugin(plug.id)}
              >
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    {plug.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 280 }}>
                    {plug.description}
                  </Typography>
                </Box>
              </MenuItem>
            ))}
            <Divider />
            <MenuItem
              selected={activePluginId === MANAGE_PLUGINS_ID}
              onClick={() => onSelectPlugin(MANAGE_PLUGINS_ID)}
            >
              <Box>
                <Typography variant="body2" fontWeight={600}>
                  Manage plugins…
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 280 }}>
                  Install plugin.json packs, enable or remove plugins
                </Typography>
              </Box>
            </MenuItem>
          </Menu>
          <FormControlLabel
            control={
              <Switch
                checked={advanced}
                onChange={(e) => onAdvanced(e.target.checked)}
                size="small"
              />
            }
            label={<Typography variant="caption" color="text.secondary">Advanced</Typography>}
            title="Show developer details and fuller filters"
            sx={{ m: 0, ml: 0.5 }}
          />
          <IconButton
            size="small"
            onClick={onTheme}
            title={theme === 'blink' ? 'Switch to light' : 'Switch to dark'}
            aria-label="Toggle color theme"
            sx={{ border: 1, borderColor: 'divider', borderRadius: 3 }}
          >
            {theme === 'blink' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
          </IconButton>
        </Stack>
      </Toolbar>
    </AppBar>
  )
}
