import { useEffect, useState } from 'react'
import { Alert, Box, Button, Divider, Stack, TextField, Typography } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'

interface BridgeStatus {
  running: boolean
  host: string
  port: number
  version: string
}

/**
 * Vault Bridge settings: shows the loopback HTTP bridge status and the
 * per-install bearer token (needed by the Obsidian plugin / scripts).
 */
export function BridgeSettings() {
  const [status, setStatus] = useState<BridgeStatus | null>(null)
  const [token, setToken] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!window.lkv?.bridge) return
    try {
      setStatus(await window.lkv.bridge.status())
      setToken(await window.lkv.bridge.getToken())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const regenerate = async () => {
    if (!window.lkv?.bridge) return
    try {
      setToken(await window.lkv.bridge.rotateToken())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const statusText = status
    ? status.running
      ? `Listening on http://${status.host}:${status.port}`
      : 'Not running'
    : '…'

  return (
    <Box sx={{ mt: 2 }}>
      <Divider sx={{ my: 1.5 }} />
      <Typography variant="subtitle2">Vault Bridge</Typography>
      <Typography variant="caption" color="text.secondary">
        Local HTTP API for Obsidian / scripts. {statusText}
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
      <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mt: 1 }}>
        <TextField
          size="small"
          fullWidth
          label="Bearer token"
          value={token}
          inputProps={{ readOnly: true }}
          onFocus={(e) => e.currentTarget.select()}
          helperText="Send as “Authorization: Bearer <token>” to /v1/ask and /v1/projects."
        />
        <Button
          size="small"
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => void regenerate()}
          sx={{ mt: 0.25 }}
        >
          Regenerate
        </Button>
      </Stack>
    </Box>
  )
}
