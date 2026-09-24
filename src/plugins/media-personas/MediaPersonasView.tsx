import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver'
import AddIcon from '@mui/icons-material/Add'
import type { VaultPluginRenderProps } from '../types'
import type { MediaProjectInfo, MediaVoicePackInfo, Prompt } from '../../../electron/types'
import { MEDIA_PERSONAS, type MediaPersonaDef } from './personas'

export function MediaPersonasView({ onClose }: VaultPluginRenderProps) {
  const [projects, setProjects] = useState<MediaProjectInfo[]>([])
  const [selectedProject, setSelectedProject] = useState('')
  const [installed, setInstalled] = useState<Record<string, Prompt | null>>({})
  const [customPacks, setCustomPacks] = useState<MediaVoicePackInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  // Easy Add form
  const [newName, setNewName] = useState('')
  const [newStyle, setNewStyle] = useState('')
  const [newDesc, setNewDesc] = useState('')

  const refreshProjects = useCallback(async () => {
    if (!window.lkv?.media?.listProjects) {
      setProjects([])
      return
    }
    const list = await window.lkv.media.listProjects()
    setProjects(list)
    setSelectedProject((prev) => {
      if (prev && list.some((p) => p.project === prev)) return prev
      return list[0]?.project ?? ''
    })
  }, [])

  const refreshInstalled = useCallback(async () => {
    if (!window.lkv?.prompts?.list) {
      setInstalled({})
      return
    }
    const prompts = await window.lkv.prompts.list()
    const map: Record<string, Prompt | null> = {}
    for (const def of MEDIA_PERSONAS) {
      map[def.name] = prompts.find((p) => p.name === def.name) ?? null
    }
    setInstalled(map)
  }, [])

  const refreshCustom = useCallback(async () => {
    if (!window.lkv?.media?.listVoicePacks) {
      setCustomPacks([])
      return
    }
    const packs = await window.lkv.media.listVoicePacks()
    setCustomPacks(packs.filter((p) => !p.builtin))
  }, [])

  useEffect(() => {
    void refreshProjects()
    void refreshInstalled()
    void refreshCustom()
  }, [refreshProjects, refreshInstalled, refreshCustom])

  const ensureAll = async () => {
    if (!window.lkv?.media?.ensurePersonas) {
      setError('Media personas IPC is unavailable. Restart the app after updating.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = await window.lkv.media.ensurePersonas()
      await refreshInstalled()
      await refreshCustom()
      const bits: string[] = []
      if (r.created.length) bits.push(`created ${r.created.join(', ')}`)
      if (r.updated.length) bits.push(`refreshed ${r.updated.join(', ')}`)
      setStatus(
        bits.length
          ? `Personas ready — ${bits.join('; ')}.`
          : `All ${r.names.length} Media personas already up to date.`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const installOne = async (def: MediaPersonaDef) => {
    if (!window.lkv?.media?.ensurePersonas) {
      setError('Media personas IPC is unavailable.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await window.lkv.media.ensurePersonas()
      await refreshInstalled()
      setStatus(`Installed / refreshed “${def.name}”.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /** Optional advanced: also save an Ask profile bound to one project. Default path is Install + Media chat chips. */
  const alsoSaveAskProfile = async (personaName: string) => {
    if (!window.lkv?.media?.applyPersona) {
      setError('Media personas IPC is unavailable.')
      return
    }
    const project = selectedProject.trim()
    if (!project) {
      setError('Select a media project first (ingest one in Media chat if the list is empty).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = await window.lkv.media.applyPersona({
        persona: personaName,
        project,
        displayTitle: project,
      })
      await refreshInstalled()
      await refreshCustom()
      setStatus(
        `Also saved Ask profile “${r.profileName}” for this project. Usual path: pick “${personaName}” from Media chat voice chips (works with any media).`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const saveCustom = async () => {
    if (!window.lkv?.media?.createPersona) {
      setError('Easy Add persona IPC is unavailable. Restart the app after updating.')
      return
    }
    const name = newName.trim()
    const speakingStyle = newStyle.trim()
    if (!name) {
      setError('Name is required.')
      return
    }
    if (!speakingStyle) {
      setError('Short vibe / speaking style is required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = await window.lkv.media.createPersona({
        name,
        speakingStyle,
        description: newDesc.trim() || undefined,
      })
      setNewName('')
      setNewStyle('')
      setNewDesc('')
      await refreshCustom()
      setStatus(
        `Custom voice “${r.name}” saved — available in Media chat voice chips for any media project.`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const hasProjectsApi = !!window.lkv?.media?.listProjects
  const hasEnsureApi = !!window.lkv?.media?.ensurePersonas
  const hasCreateApi = !!window.lkv?.media?.createPersona

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, p: 1.5, gap: 1.5 }}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
        <RecordVoiceOverIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
          Media personas
        </Typography>
        <Button size="small" variant="outlined" disabled={busy || !hasEnsureApi} onClick={() => void ensureAll()}>
          Install / refresh all
        </Button>
        {onClose && (
          <Button size="small" onClick={onClose}>
            Back to Ask
          </Button>
        )}
      </Stack>

      {/* Easy Add — top of panel so it is visible without scrolling */}
      <Card variant="outlined" sx={{ borderColor: 'primary.main', borderWidth: 1.5, flexShrink: 0 }}>
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <AddIcon color="primary" fontSize="small" />
            <Typography variant="subtitle1" fontWeight={600}>
              Add persona
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Invent a voice without editing code. Grounding rules stay the same; your vibe only shapes style.
          </Typography>
          {!hasCreateApi && (
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              Easy Add is unavailable — restart the app after updating so <code>media:createPersona</code> loads.
            </Alert>
          )}
          <Stack spacing={1.5}>
            <TextField
              size="small"
              required
              label="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={busy || !hasCreateApi}
              placeholder="e.g. Late-night host"
            />
            <TextField
              size="small"
              required
              multiline
              minRows={2}
              label="Short vibe / speaking style"
              value={newStyle}
              onChange={(e) => setNewStyle(e.target.value)}
              disabled={busy || !hasCreateApi}
              placeholder="e.g. Warm, slightly wry; short paragraphs; ask one clarifying question when the clip is ambiguous."
            />
            <TextField
              size="small"
              multiline
              minRows={1}
              label="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              disabled={busy || !hasCreateApi}
              placeholder="Shown on the card — what this voice is for"
            />
          </Stack>
        </CardContent>
        <CardActions sx={{ px: 2, pb: 2, pt: 0 }}>
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            disabled={busy || !hasCreateApi || !newName.trim() || !newStyle.trim()}
            onClick={() => void saveCustom()}
            title={!hasCreateApi ? 'Restart app after update' : undefined}
          >
            Save persona
          </Button>
        </CardActions>
      </Card>

      {status && (
        <Alert severity="success" onClose={() => setStatus(null)}>
          {status}
        </Alert>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Typography variant="body2" color="text.secondary">
        Voice packs work with any ingested media (not one persona per video). Install built-ins below, or use
        Add persona above, then pick them as chips in Media chat.
      </Typography>

      <Typography variant="subtitle2" fontWeight={600}>
        Built-in voice packs
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' },
          gap: 1.5,
        }}
      >
        {MEDIA_PERSONAS.map((def) => {
          const prompt = installed[def.name]
          const installedLabel = prompt ? 'Installed' : 'Not installed'
          return (
            <Card key={def.id} variant="outlined" sx={{ display: 'flex', flexDirection: 'column' }}>
              <CardContent sx={{ flex: 1 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                  <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
                    {def.name}
                  </Typography>
                  <Typography
                    variant="caption"
                    color={prompt ? 'success.main' : 'text.secondary'}
                    sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}
                  >
                    {installedLabel}
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {def.description}
                </Typography>
              </CardContent>
              <CardActions sx={{ px: 2, pb: 2, pt: 0, flexWrap: 'wrap', gap: 0.5 }}>
                <Button
                  size="small"
                  variant="contained"
                  disabled={busy || !hasEnsureApi}
                  onClick={() => void installOne(def)}
                >
                  {prompt ? 'Refresh prompt' : 'Install'}
                </Button>
                <Typography variant="caption" color="text.secondary" sx={{ width: '100%', px: 0.5 }}>
                  Available in Media chat voice chips
                </Typography>
              </CardActions>
            </Card>
          )
        })}
      </Box>

      <Divider />

      <Typography variant="subtitle2" fontWeight={600}>
        Custom voice packs
      </Typography>
      {customPacks.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No custom personas yet — use Add persona above.
        </Typography>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' },
            gap: 1.5,
            overflow: 'auto',
            minHeight: 0,
            pb: 1,
          }}
        >
          {customPacks.map((pack) => (
            <Card key={pack.promptId} variant="outlined" sx={{ display: 'flex', flexDirection: 'column' }}>
              <CardContent sx={{ flex: 1 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                  <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
                    {pack.name}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="success.main"
                    sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}
                  >
                    Custom
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {pack.description.replace(/^Media voice pack:\s*/i, '') || 'Custom grounded Media voice.'}
                </Typography>
              </CardContent>
              <CardActions sx={{ px: 2, pb: 2, pt: 0, flexWrap: 'wrap', gap: 0.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
                  Available in Media chat voice chips (any media)
                </Typography>
              </CardActions>
            </Card>
          ))}
        </Box>
      )}

      <Alert severity="info" variant="outlined">
        <Typography variant="body2">
          After install, use the voice chips in <strong>Media chat</strong> — the open media project scopes
          notes; the persona only changes voice. You can also pick the personality in{' '}
          <strong>Ask → Customize</strong>. Grounding rules always win over style.
        </Typography>
      </Alert>

      {hasProjectsApi && (
        <Box sx={{ mt: 1, opacity: 0.95 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Advanced (optional): also save an Ask profile for one project. Not required — voice packs already
            work across all media.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-start' }}>
            <TextField
              select
              size="small"
              label="Media project (optional)"
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              disabled={busy || projects.length === 0}
              helperText={
                projects.length === 0
                  ? 'No media projects yet — ingest in Media chat first.'
                  : 'Creates a chat profile like “Desk cohost · &lt;project&gt;” for Ask Customize only.'
              }
              sx={{ maxWidth: 420, flex: 1 }}
            >
              {projects.map((p) => (
                <MenuItem key={p.project} value={p.project}>
                  {p.project} ({p.noteCount} notes)
                </MenuItem>
              ))}
            </TextField>
            <Stack spacing={0.5} sx={{ pt: { sm: 0.5 } }}>
              {MEDIA_PERSONAS.map((def) => (
                <Button
                  key={def.id}
                  size="small"
                  variant="text"
                  disabled={busy || !hasEnsureApi || !selectedProject}
                  onClick={() => void alsoSaveAskProfile(def.name)}
                >
                  Also save Ask profile · {def.name}
                </Button>
              ))}
              {customPacks.map((pack) => (
                <Button
                  key={pack.promptId}
                  size="small"
                  variant="text"
                  disabled={busy || !selectedProject}
                  onClick={() => void alsoSaveAskProfile(pack.name)}
                >
                  Also save Ask profile · {pack.name}
                </Button>
              ))}
            </Stack>
          </Stack>
        </Box>
      )}
    </Box>
  )
}
