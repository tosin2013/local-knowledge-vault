import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, Card, CardActions, CardContent, Chip, Stack, Typography } from '@mui/material'
import ExtensionIcon from '@mui/icons-material/Extension'
import type { PluginContributions } from '../../electron/types'

/** Fired after installing / enabling / removing a declarative plugin so views can refresh. */
export const PLUGINS_CHANGED_EVENT = 'lkv-plugins-changed'

export function notifyPluginsChanged() {
  window.dispatchEvent(new Event(PLUGINS_CHANGED_EVENT))
}

const EMPTY: PluginContributions = { providers: [], personas: [], promptPacks: [], mcpServers: [] }

/** Contributions from enabled declarative plugins (plugin.json). */
export function usePluginContributions(): PluginContributions {
  const [c, setC] = useState<PluginContributions>(EMPTY)
  const load = useCallback(async () => {
    if (!window.lkv?.plugins?.contributions) return
    try {
      setC(await window.lkv.plugins.contributions())
    } catch {
      setC(EMPTY)
    }
  }, [])
  useEffect(() => {
    void load()
    window.addEventListener(PLUGINS_CHANGED_EVENT, load)
    return () => window.removeEventListener(PLUGINS_CHANGED_EVENT, load)
  }, [load])
  return c
}

/** Personas contributed by plugins — one click installs them via the same Easy Add path. */
export function PluginPersonasSection({ onInstalled }: { onInstalled?: (name: string) => void }) {
  const { personas } = usePluginContributions()
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState<string | null>(null)
  if (!personas.length) return null
  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <ExtensionIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" fontWeight={600}>
          From plugins
        </Typography>
      </Stack>
      {err && (
        <Alert severity="error" onClose={() => setErr(null)} sx={{ mb: 1 }}>
          {err}
        </Alert>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' }, gap: 1.5 }}>
        {personas.map((p) => {
          const key = `${p.pluginId}:${p.name}`
          return (
            <Card key={key} variant="outlined">
              <CardContent sx={{ pb: 1 }}>
                <Typography variant="subtitle2">{p.name}</Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {p.pluginName}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {p.description ?? p.prompt.slice(0, 140)}
                </Typography>
              </CardContent>
              <CardActions>
                <Button
                  size="small"
                  variant={done[key] ? 'outlined' : 'contained'}
                  disabled={busy !== null || !window.lkv?.media?.createPersona}
                  onClick={async () => {
                    setBusy(key)
                    setErr(null)
                    try {
                      await window.lkv.media.createPersona({ name: p.name, speakingStyle: p.prompt, description: p.description })
                      setDone((d) => ({ ...d, [key]: true }))
                      onInstalled?.(p.name)
                    } catch (e) {
                      setErr(e instanceof Error ? e.message : String(e))
                    } finally {
                      setBusy(null)
                    }
                  }}
                >
                  {done[key] ? 'Installed' : busy === key ? 'Installing…' : 'Install'}
                </Button>
              </CardActions>
            </Card>
          )
        })}
      </Box>
    </Box>
  )
}

/** MCP server presets contributed by plugins (name + URL; OAuth happens on Connect). */
export function PluginMcpPresetsSection({
  existingUrls,
  onAdded,
  onError,
}: {
  existingUrls: string[]
  onAdded: () => void
  onError: (msg: string) => void
}) {
  const { mcpServers } = usePluginContributions()
  if (!mcpServers.length) return null
  const norm = (u: string) => u.replace(/\/+$/, '').toLowerCase()
  const have = new Set(existingUrls.map(norm))
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <ExtensionIcon fontSize="small" color="primary" />
          <Typography variant="subtitle2">Suggested by plugins</Typography>
        </Stack>
        <Stack spacing={1}>
          {mcpServers.map((s) => {
            const added = have.has(norm(s.url))
            return (
              <Stack key={`${s.pluginId}:${s.url}`} direction="row" spacing={1} alignItems="center">
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {s.name} <Chip size="small" variant="outlined" label={s.pluginName} sx={{ ml: 0.5 }} />
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {s.description ? `${s.description} · ` : ''}
                    {s.url}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={added}
                  onClick={async () => {
                    try {
                      await window.lkv.mcp.addServer({ name: s.name, url: s.url })
                      onAdded()
                    } catch (e) {
                      onError(e instanceof Error ? e.message : String(e))
                    }
                  }}
                >
                  {added ? 'Added' : 'Add'}
                </Button>
              </Stack>
            )
          })}
        </Stack>
      </CardContent>
    </Card>
  )
}
