import { Alert } from '@mui/material'
import type { LlmStatus } from '../../../electron/types'

/**
 * Says plainly when this computer cannot encrypt saved secrets (#237), e.g. Linux without
 * a keyring. Nothing is shown when keys are encrypted or the status is not known yet.
 */
export function KeyStorageNotice({ keyStorage }: { keyStorage: LlmStatus['keyStorage'] }) {
  if (keyStorage !== 'plaintext') return null
  return (
    <Alert severity="info" variant="outlined" sx={{ mt: 1.5, borderRadius: 2 }} data-testid="key-storage-notice">
      This computer has no system keychain Vault can use, so API keys and the Vault Bridge token are
      saved as files only your user account can open, but they are not encrypted. On Linux, installing
      and unlocking a keyring (GNOME Keyring or KWallet) lets Vault encrypt them the next time it starts.
    </Alert>
  )
}
