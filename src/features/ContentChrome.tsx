import { Alert, Box, Chip, IconButton, Stack, ToggleButton, ToggleButtonGroup } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import type { Mode } from '../domain'
import { getPlugin } from '../plugins/registry'

export interface ContentChromeProps {
  mode: Mode
  activePluginId: string | null
  statusMsg: string | null
  error: string | null
  onToggleMode: (v: 'search' | 'chat') => void
  onClearPlugin: () => void
  onClosePlugin: () => void
  onDismissStatus: () => void
  onDismissError: () => void
  onOpenNote: (id: string) => void
}

export function ContentChrome(props: ContentChromeProps) {
  const {
    mode,
    activePluginId,
    statusMsg,
    error,
    onToggleMode,
    onClearPlugin,
    onClosePlugin,
    onDismissStatus,
    onDismissError,
    onOpenNote,
  } = props

  return (
    <>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ m: 1.5, alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={mode === 'search' || mode === 'chat' ? mode : null}
          onChange={(_e, v) => {
            if (v === 'search' || v === 'chat') {
              onToggleMode(v)
            }
          }}
          aria-label="Primary mode"
          sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 999, p: 0.25 }}
        >
          <ToggleButton value="search" aria-label="Find">
            Find
          </ToggleButton>
          <ToggleButton value="chat" aria-label="Ask">
            Ask
          </ToggleButton>
        </ToggleButtonGroup>
        {mode === 'prompts' && <Chip size="small" variant="outlined" label="Personalities" />}
        {activePluginId && (
          <Chip
            size="small"
            color="primary"
            variant="outlined"
            label={getPlugin(activePluginId)?.name ?? 'Plugin'}
            onDelete={onClearPlugin}
          />
        )}
      </Stack>

      {statusMsg && (
        <Box sx={{ px: 2, pt: 1 }}>
          <Alert
            severity="success"
            role="status"
            action={
              <IconButton size="small" aria-label="Dismiss" onClick={onDismissStatus}>
                <CloseIcon fontSize="small" />
              </IconButton>
            }
          >
            {statusMsg}
          </Alert>
        </Box>
      )}

      {error && (
        <Box sx={{ px: 2, pt: 1 }}>
          <Alert
            severity="error"
            role="alert"
            action={
              <IconButton size="small" aria-label="Dismiss error" onClick={onDismissError}>
                <CloseIcon fontSize="small" />
              </IconButton>
            }
          >
            {error}
          </Alert>
        </Box>
      )}

      {activePluginId && (() => {
        const plug = getPlugin(activePluginId)
        if (!plug) {
          return (
            <Alert severity="warning" sx={{ m: 2 }}>
              Unknown plugin
            </Alert>
          )
        }
        const PluginView = plug.render
        return (
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'auto',
            }}
          >
            <PluginView
              onOpenNote={onOpenNote}
              onClose={onClosePlugin}
            />
          </Box>
        )
      })()}
    </>
  )
}
