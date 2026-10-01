import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { UpdateNotice } from '../../src/components/updates/UpdateNotice'
import { UpdateSettings } from '../../src/components/updates/UpdateSettings'

const available = {
  ok: true,
  current: '0.3.0',
  latest: '0.4.0',
  updateAvailable: true,
  url: 'https://github.com/tosin2013/local-knowledge-vault/releases/tag/v0.4.0',
}

describe('UpdateNotice (#42)', () => {
  it('shows a notice with a download link when a newer version exists', async () => {
    const lkv = window.lkv as any
    lkv.updates.checkOnLaunch.mockResolvedValue(available)
    render(<UpdateNotice />)

    await waitFor(() => expect(screen.getByText('Vault 0.4.0 is available. You have 0.3.0.')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', available.url)
  })

  it('stays hidden when up to date, skipped, or the check fails', async () => {
    const lkv = window.lkv as any
    for (const r of [
      { ok: true, current: '0.3.0', latest: '0.3.0', updateAvailable: false },
      { ok: true, current: '0.3.0', updateAvailable: false, skipped: 'disabled' },
      { ok: false, current: '0.3.0', error: 'offline' },
    ]) {
      lkv.updates.checkOnLaunch.mockResolvedValue(r)
      const { unmount } = render(<UpdateNotice />)
      await waitFor(() => expect(lkv.updates.checkOnLaunch).toHaveBeenCalled())
      expect(screen.queryByTestId('update-notice')).not.toBeInTheDocument()
      unmount()
    }
    lkv.updates.checkOnLaunch.mockRejectedValue(new Error('ipc down'))
    render(<UpdateNotice />)
    await waitFor(() => expect(lkv.updates.checkOnLaunch).toHaveBeenCalled())
    expect(screen.queryByTestId('update-notice')).not.toBeInTheDocument()
  })

  it('does not show a version the user already dismissed', async () => {
    const lkv = window.lkv as any
    lkv.updates.checkOnLaunch.mockResolvedValue(available)
    const first = render(<UpdateNotice />)
    await waitFor(() => expect(screen.getByTestId('update-notice')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('update-notice')).not.toBeInTheDocument()
    first.unmount()

    lkv.updates.checkOnLaunch.mockClear()
    render(<UpdateNotice />)
    await waitFor(() => expect(lkv.updates.checkOnLaunch).toHaveBeenCalled())
    expect(screen.queryByTestId('update-notice')).not.toBeInTheDocument()
  })
})

describe('UpdateSettings (#42)', () => {
  it('loads the setting and turns the launch check off', async () => {
    const lkv = window.lkv as any
    render(<UpdateSettings />)
    const toggle = await screen.findByRole('checkbox', { name: 'Check for updates when Vault starts' })
    await waitFor(() => expect(toggle).toBeChecked())
    fireEvent.click(toggle)
    await waitFor(() => expect(lkv.updates.setSettings).toHaveBeenCalledWith({ checkOnLaunch: false }))
    await waitFor(() => expect(toggle).not.toBeChecked())
  })

  it('reports up to date, an available update, and a failed check', async () => {
    const lkv = window.lkv as any
    render(<UpdateSettings />)
    const checkNow = screen.getByRole('button', { name: 'Check now' })

    fireEvent.click(checkNow)
    await waitFor(() => expect(screen.getByText('You’re up to date (Vault 0.3.0).')).toBeInTheDocument())

    lkv.updates.check.mockResolvedValue(available)
    fireEvent.click(checkNow)
    await waitFor(() => expect(screen.getByText(/Vault 0.4.0 is available/)).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', available.url)

    lkv.updates.check.mockResolvedValue({ ok: false, current: '0.3.0', error: 'GitHub answered 403' })
    fireEvent.click(checkNow)
    await waitFor(() => expect(screen.getByText('Couldn’t check for updates: GitHub answered 403')).toBeInTheDocument())
  })
})
