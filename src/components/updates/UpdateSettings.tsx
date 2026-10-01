import { useEffect, useState } from 'react'
import { Box, Button, Divider, FormControlLabel, Link, Stack, Switch, Typography } from '@mui/material'
import type { UpdateCheckResult } from '../../../electron/types'

/**
 * Updates section in Settings (#42): shows the running version, a manual
 * "Check now", and the switch for the launch-time check.
 */
export function UpdateSettings() {
  const [checkOnLaunch, setCheckOnLaunch] = useState(true)
  const [result, setResult] = useState<UpdateCheckResult | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!window.lkv?.updates) return
    void window.lkv.updates
      .getSettings()
      .then((s) => setCheckOnLaunch(s.checkOnLaunch))
      .catch(() => undefined)
  }, [])

  if (!window.lkv?.updates) return null

  const toggle = async (next: boolean) => {
    setCheckOnLaunch(next)
    try {
      setCheckOnLaunch((await window.lkv.updates.setSettings({ checkOnLaunch: next })).checkOnLaunch)
    } catch {
      setCheckOnLaunch(!next)
    }
  }

  const checkNow = async () => {
    setChecking(true)
    try {
      setResult(await window.lkv.updates.check())
    } catch (e) {
      setResult({ ok: false, current: '', error: e instanceof Error ? e.message : String(e) })
    } finally {
      setChecking(false)
    }
  }

  return (
    <Box sx={{ mt: 2 }} data-testid="update-settings">
      <Divider sx={{ my: 1.5 }} />
      <Typography variant="subtitle2">Updates</Typography>
      <Typography variant="caption" color="text.secondary">
        Vault only tells you when a new version exists; you download and install it yourself.
      </Typography>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
        <FormControlLabel
          control={<Switch size="small" checked={checkOnLaunch} onChange={(e) => void toggle(e.target.checked)} />}
          label={<Typography variant="body2">Check for updates when Vault starts</Typography>}
        />
        <Button size="small" onClick={() => void checkNow()} disabled={checking}>
          {checking ? 'Checking…' : 'Check now'}
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        The check is one request to GitHub for the latest release. It sends nothing about you or your notes.
      </Typography>
      {result && (
        <Typography variant="body2" sx={{ mt: 0.5 }} role="status">
          {!result.ok ? (
            `Couldn’t check for updates: ${result.error}`
          ) : result.updateAvailable && result.latest ? (
            <>
              Vault {result.latest} is available. You have {result.current}.{' '}
              <Link href={result.url} target="_blank" rel="noreferrer">
                Download
              </Link>
            </>
          ) : (
            `You’re up to date (Vault ${result.current}).`
          )}
        </Typography>
      )}
    </Box>
  )
}
