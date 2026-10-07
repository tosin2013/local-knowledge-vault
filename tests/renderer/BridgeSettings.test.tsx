import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BridgeSettings } from '../../src/components/ai/BridgeSettings'
import { lkvMock } from './lkv'

describe('BridgeSettings', () => {
  it('loads and displays the running status and token', async () => {
    const lkv = lkvMock()
    lkv.bridge.status.mockResolvedValue({ running: true, host: '127.0.0.1', port: 8765, version: '1.0.0' })
    lkv.bridge.getToken.mockResolvedValue('tok_abc')
    render(<BridgeSettings />)

    await waitFor(() => expect(screen.getByText(/Listening on http:\/\/127.0.0.1:8765/)).toBeInTheDocument())
    expect(screen.getByDisplayValue('tok_abc')).toBeInTheDocument()
  })

  it('shows the not-running state', async () => {
    const lkv = lkvMock()
    lkv.bridge.status.mockResolvedValue({ running: false, host: '', port: 0, version: '1.0.0' })
    render(<BridgeSettings />)

    await waitFor(() => expect(screen.getByText(/Not running/)).toBeInTheDocument())
  })

  it('says why the bridge is not listening when the port is taken (#240)', async () => {
    const lkv = lkvMock()
    lkv.bridge.status.mockResolvedValue({
      running: false,
      host: '127.0.0.1',
      port: 8765,
      version: '1.0.0',
      error: 'Port 8765 is already in use (another Vault profile or app?).',
    })
    render(<BridgeSettings />)
    await waitFor(() => expect(screen.getByText(/Not running/)).toBeInTheDocument())
    expect(screen.getByTestId('bridge-status-error')).toHaveTextContent('Port 8765 is already in use')
  })

  it('regenerates the token', async () => {
    const lkv = lkvMock()
    lkv.bridge.status.mockResolvedValue({ running: true, host: '127.0.0.1', port: 8765, version: '1.0.0' })
    lkv.bridge.getToken.mockResolvedValue('tok_old')
    lkv.bridge.rotateToken.mockResolvedValue('tok_new')
    render(<BridgeSettings />)

    await waitFor(() => expect(screen.getByDisplayValue('tok_old')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(screen.getByDisplayValue('tok_new')).toBeInTheDocument())
    expect(lkv.bridge.rotateToken).toHaveBeenCalled()
  })

  it('shows an error when the bridge is unreachable', async () => {
    const lkv = lkvMock()
    lkv.bridge.status.mockRejectedValue(new Error('bridge down'))
    lkv.bridge.getToken.mockRejectedValue(new Error('bridge down'))
    render(<BridgeSettings />)

    await waitFor(() => expect(screen.getByText('bridge down')).toBeInTheDocument())
  })
})
