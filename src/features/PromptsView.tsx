import { useState } from 'react'
import { Box, Button, Chip, Link, List, ListItemButton, Paper, Stack, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import type { Prompt } from '../../electron/types'
import { personalityDisplayName } from '../domain'
import {
  PERSONALITY_CAN_CHANGE,
  PERSONALITY_HELPER_PROMPT,
  PERSONALITY_TEMPLATES,
  type PersonalityTemplate,
} from '../personalityHelp'

export interface PromptDraft {
  name: string
  body: string
  description: string
}

export interface PromptsViewProps {
  advanced: boolean
  busy: boolean
  prompts: Prompt[]
  editingPrompt: Prompt | null
  promptBodyOpen: boolean
  promptDraft: PromptDraft
  promptDirty: boolean
  onNewPrompt: () => void
  onSelectPrompt: (p: Prompt) => void
  onDraft: (updater: (d: PromptDraft) => PromptDraft) => void
  onDirty: (dirty: boolean) => void
  onBodyOpen: (open: boolean) => void
  onUseInAsk: (promptId: string) => void
  onDeletePrompt: () => void
  onSavePrompt: () => void
}

export function PromptsView(props: PromptsViewProps) {
  const {
    advanced,
    busy,
    prompts,
    editingPrompt,
    promptBodyOpen,
    promptDraft,
    promptDirty,
    onNewPrompt,
    onSelectPrompt,
    onDraft,
    onDirty,
    onBodyOpen,
    onUseInAsk,
    onDeletePrompt,
    onSavePrompt,
  } = props

  const [copied, setCopied] = useState(false)

  const applyTemplate = (t: PersonalityTemplate) => {
    onDraft(() => ({ name: t.name, description: t.description, body: t.instructions }))
    onDirty(true)
  }

  const copyHelperPrompt = async () => {
    try {
      await navigator.clipboard.writeText(PERSONALITY_HELPER_PROMPT)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard may be unavailable (file:// or denied) */
    }
  }

  return (
    <Box className="prompts-layout">
      <Paper
        component="aside"
        className="prompt-list-pane"
        square
        sx={{ bgcolor: 'background.paper', borderRight: 1, borderColor: 'divider', borderRadius: 0 }}
      >
        <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Button
            fullWidth
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={onNewPrompt}
          >
            New personality
          </Button>
        </Box>
        <Box className="session-list" sx={{ p: 1 }}>
          {prompts.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', p: 1.5 }}>
              No personalities yet.
            </Typography>
          )}
          <List dense disablePadding>
            {prompts.map((p) => (
              <ListItemButton
                key={p.id}
                selected={editingPrompt?.id === p.id}
                onClick={() => onSelectPrompt(p)}
                sx={{
                  mb: 0.25,
                  borderRadius: 3,
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  borderLeft: editingPrompt?.id === p.id ? 3 : 0,
                  borderColor: 'primary.main',
                }}
              >
                <Typography variant="body2" fontWeight={600} noWrap>
                  {personalityDisplayName(p)}
                </Typography>
                {p.description && (
                  <Typography variant="caption" color="text.secondary">
                    {p.description}
                  </Typography>
                )}
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Paper>
      <Box className="panel" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {!editingPrompt && !promptBodyOpen ? (
          <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Paper sx={{ p: 4, maxWidth: 420, textAlign: 'center', borderRadius: 5 }}>
              <Typography variant="h6" color="primary" gutterBottom>
                Personalities
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Pick how Ask should answer. You can add your own personalities.
              </Typography>
            </Paper>
          </Box>
        ) : (
          <>
            <Typography variant="h6">
              {editingPrompt ? personalityDisplayName(editingPrompt) : 'New personality'}
            </Typography>
            <TextField
              fullWidth
              label="Name"
              value={promptDraft.name}
              onChange={(e) => {
                onDraft((d) => ({ ...d, name: e.target.value }))
                onDirty(true)
              }}
              placeholder="e.g. Concise bullets"
            />
            <TextField
              fullWidth
              label="Description"
              value={promptDraft.description}
              onChange={(e) => {
                onDraft((d) => ({ ...d, description: e.target.value }))
                onDirty(true)
              }}
              placeholder="Optional short description"
            />

            {!advanced && !promptBodyOpen ? (
              <Box sx={{ mt: 1 }}>
                <Typography variant="body2" color="text.secondary" paragraph>
                  {editingPrompt
                    ? 'This personality is ready to use in Ask. Open Edit to change how it answers.'
                    : 'Add a name, then Edit to write the personality instructions.'}
                </Typography>
                <Button variant="outlined" size="small" onClick={() => onBodyOpen(true)}>
                  Edit
                </Button>
                {editingPrompt && (
                  <Button
                    variant="contained"
                    size="small"
                    sx={{ ml: 1 }}
                    onClick={() => onUseInAsk(editingPrompt.id)}
                  >
                    Use in Ask
                  </Button>
                )}
              </Box>
            ) : (
              <>
                <Box sx={{ bgcolor: 'action.hover', borderRadius: 2, p: 1.5 }}>
                  <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>
                    What a personality can change
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {PERSONALITY_CAN_CHANGE}
                  </Typography>
                </Box>
                <Stack direction="row" flexWrap="wrap" alignItems="center" gap={0.75}>
                  <Typography variant="caption" color="text.secondary">
                    Start from a template:
                  </Typography>
                  {PERSONALITY_TEMPLATES.map((t) => (
                    <Chip
                      key={t.name}
                      size="small"
                      variant="outlined"
                      label={t.name}
                      title={t.description}
                      onClick={() => applyTemplate(t)}
                    />
                  ))}
                </Stack>
                <TextField
                  fullWidth
                  multiline
                  minRows={10}
                  label="Instructions"
                  value={promptDraft.body}
                  onChange={(e) => {
                    onDraft((d) => ({ ...d, body: e.target.value }))
                    onDirty(true)
                  }}
                  placeholder="Additional guidance merged with grounded citation rules…"
                  InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }}
                />
                <Typography variant="caption" color="text.secondary">
                  Answers still come from your notes. These instructions only change tone and format.
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => void copyHelperPrompt()}>
                    {copied ? 'Copied' : 'Copy helper prompt'}
                  </Button>
                  <Link
                    component="a"
                    href="https://github.com/tosin2013/local-knowledge-vault/blob/main/docs/personalities.md"
                    target="_blank"
                    rel="noreferrer"
                    variant="caption"
                  >
                    Personality guide
                  </Link>
                </Stack>
                <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
                  {editingPrompt && (
                    <Button color="error" variant="outlined" onClick={onDeletePrompt}>
                      Delete
                    </Button>
                  )}
                  {!advanced && (
                    <Button onClick={() => onBodyOpen(false)}>Done editing</Button>
                  )}
                  <Button
                    variant="contained"
                    disabled={
                      busy || !promptDirty || !promptDraft.name.trim() || !promptDraft.body.trim()
                    }
                    onClick={onSavePrompt}
                  >
                    Save
                  </Button>
                </Stack>
              </>
            )}
          </>
        )}
      </Box>
    </Box>
  )
}
