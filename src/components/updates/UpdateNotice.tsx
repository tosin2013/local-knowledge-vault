import { useEffect, useState } from 'react'
import { Alert, Button, Snackbar } from '@mui/material'

const DISMISSED_KEY = 'lkv-update-dismissed'

/**
 * Launch-time update notice (#42). Asks the main process once whether a newer
 * release exists and offers a link to the download page. Nothing is downloaded
 * or installed by the app. A dismissed version stays dismissed.
 */
export function UpdateNotice() {
  const [update, setUpdate] = useState<{ current: string; latest: string; url: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await window.lkv?.updates?.checkOnLaunch()
        if (cancelled || !r?.ok || !r.updateAvailable || !r.latest || !r.url) return
        if (localStorage.getItem(DISMISSED_KEY) === r.latest) return
        setUpdate({ current: r.current, latest: r.latest, url: r.url })
      } catch {
        /* a failed check is silent; Settings has a manual check with the error */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!update) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, update.latest)
    } catch {
      /* storage unavailable: dismiss for this session only */
    }
    setUpdate(null)
  }

  return (
    <Snackbar open anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} data-testid="update-notice">
      <Alert
        severity="info"
        variant="filled"
        onClose={dismiss}
        action={
          <>
            <Button color="inherit" size="small" href={update.url} target="_blank" rel="noreferrer">
              Download
            </Button>
            <Button color="inherit" size="small" onClick={dismiss}>
              Dismiss
            </Button>
          </>
        }
      >
        Vault {update.latest} is available. You have {update.current}.
      </Alert>
    </Snackbar>
  )
}
