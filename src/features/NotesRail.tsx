import type { Dispatch, SetStateAction } from 'react'
import {
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import type { Item, ItemFilters, Para } from '../../electron/types'
import { isValidHttpUrl, KIND_OPTIONS, PARA_OPTIONS, paraLabel, STATUS_OPTIONS } from '../domain'

export interface NotesRailProps {
  advanced: boolean
  items: Item[]
  selectedId: string | null
  filters: ItemFilters
  projectOptions: string[]
  filterSummary: string
  filtersOpen: boolean
  importUrl: string
  importBusy: boolean
  busy: boolean
  onNewNote: () => void
  onImportUrl: (v: string) => void
  onImport: () => void
  onProject: (project: string) => void
  onManageProjects: () => void
  onFilters: Dispatch<SetStateAction<ItemFilters>>
  onFiltersOpen: (open: boolean) => void
  onSelect: (id: string, opts?: { edit?: boolean }) => void
}

export function NotesRail(props: NotesRailProps) {
  const {
    advanced,
    items,
    selectedId,
    filters,
    projectOptions,
    filterSummary,
    filtersOpen,
    importUrl,
    importBusy,
    busy,
    onNewNote,
    onImportUrl,
    onImport,
    onProject,
    onManageProjects,
    onFilters,
    onFiltersOpen,
    onSelect,
  } = props

  const showExtraFilters = advanced || filtersOpen

  return (
    <Paper
      component="aside"
      className="sidebar"
      square
      sx={{ bgcolor: 'background.paper', borderRight: 1, borderColor: 'divider', borderRadius: 0 }}
    >
      <Stack spacing={1.25} sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Button
          fullWidth
          variant="contained"
          startIcon={<AddIcon />}
          onClick={onNewNote}
        >
          New note
        </Button>

        {advanced && (
          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
              Add from URL
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>
              Public https pages / articles. Import enables when the URL looks like https://… — may take a few seconds.
            </Typography>
            <Stack direction="row" spacing={0.75}>
              <TextField
                size="small"
                fullWidth
                type="url"
                placeholder="https://…"
                value={importUrl}
                disabled={importBusy || busy}
                onChange={(e) => onImportUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (isValidHttpUrl(importUrl)) onImport()
                  }
                }}
                aria-label="URL to import"
              />
              <Button
                variant="outlined"
                size="small"
                disabled={importBusy || busy || !isValidHttpUrl(importUrl)}
                onClick={onImport}
                sx={{ flexShrink: 0 }}
                title={
                  isValidHttpUrl(importUrl)
                    ? 'Fetch and save as a note'
                    : 'Paste a full http:// or https:// URL to enable Import'
                }
              >
                {importBusy ? '…' : 'Import'}
              </Button>
            </Stack>
          </Stack>
        )}

        <Stack direction="row" spacing={0.5} alignItems="center">
          <FormControl fullWidth size="small">
            <InputLabel id="project-filter-label">Project</InputLabel>
            <Select
              labelId="project-filter-label"
              label="Project"
              value={filters.project ?? ''}
              onChange={(e) => onProject(String(e.target.value))}
              aria-label="Filter notes by project"
            >
              <MenuItem value="">All projects</MenuItem>
              {projectOptions.map((name) => (
                <MenuItem key={name} value={name}>
                  {name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <IconButton
            size="small"
            onClick={onManageProjects}
            aria-label="Manage projects"
            title="Manage projects (rename, merge, delete)"
          >
            <SettingsOutlinedIcon fontSize="small" />
          </IconButton>
        </Stack>

        {advanced && (
          <Stack direction="row" flexWrap="wrap" gap={0.75} role="group" aria-label="Group">
            <Chip
              size="small"
              label="All"
              color={!filters.para ? 'primary' : 'default'}
              variant={!filters.para ? 'filled' : 'outlined'}
              onClick={() => onFilters((f) => ({ ...f, para: '' }))}
            />
            {(['projects', 'areas', 'resources', 'archives'] as Para[]).map((p) => (
              <Chip
                key={p}
                size="small"
                label={paraLabel(p)}
                color={filters.para === p ? 'primary' : 'default'}
                variant={filters.para === p ? 'filled' : 'outlined'}
                onClick={() => onFilters((f) => ({ ...f, para: f.para === p ? '' : p }))}
              />
            ))}
          </Stack>
        )}

        {!advanced && (
          <Button
            size="small"
            variant="text"
            onClick={() => onFiltersOpen(!filtersOpen)}
            aria-expanded={filtersOpen}
            startIcon={filtersOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            sx={{ justifyContent: 'flex-start', opacity: 0.8 }}
          >
            More filters
          </Button>
        )}

        {showExtraFilters && (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
            <FormControl size="small" fullWidth>
              <InputLabel id="kind-filter-label">Type</InputLabel>
              <Select
                labelId="kind-filter-label"
                label="Type"
                value={filters.kind ?? ''}
                onChange={(e) => onFilters((f) => ({ ...f, kind: String(e.target.value) }))}
              >
                {KIND_OPTIONS.map((k) => (
                  <MenuItem key={k || 'any'} value={k}>
                    {k ? k : 'any'}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel id="status-filter-label">Status</InputLabel>
              <Select
                labelId="status-filter-label"
                label="Status"
                value={filters.status ?? ''}
                onChange={(e) => onFilters((f) => ({ ...f, status: String(e.target.value) }))}
              >
                {STATUS_OPTIONS.map((s) => (
                  <MenuItem key={s || 'any'} value={s}>
                    {s ? s : 'any'}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {advanced && (
              <FormControl size="small" fullWidth sx={{ gridColumn: '1 / -1' }}>
                <InputLabel id="para-filter-label">Group</InputLabel>
                <Select
                  labelId="para-filter-label"
                  label="Group"
                  value={filters.para ?? ''}
                  onChange={(e) =>
                    onFilters((f) => ({
                      ...f,
                      para: e.target.value as ItemFilters['para'],
                    }))
                  }
                >
                  {PARA_OPTIONS.map((p) => (
                    <MenuItem key={p || 'any'} value={p}>
                      {p ? p : 'any'}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Box>
        )}

        <Typography variant="caption" color="text.secondary">
          {filterSummary} · {items.length} notes
        </Typography>
      </Stack>

      <Box className="note-list" sx={{ p: 1 }}>
        {items.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', p: 2 }}>
            No notes match filters.
          </Typography>
        )}
        <List dense disablePadding aria-label="Notes">
          {items.map((it) => (
            <ListItemButton
              key={it.id}
              selected={selectedId === it.id}
              onClick={() => onSelect(it.id)}
              onDoubleClick={() => onSelect(it.id, { edit: true })}
              onKeyDown={(e) => {
                if (e.key === 'F2') {
                  e.preventDefault()
                  onSelect(it.id, { edit: true })
                }
              }}
              aria-keyshortcuts="Enter F2"
              sx={{
                mb: 0.5,
                flexDirection: 'column',
                alignItems: 'stretch',
                borderRadius: 3,
                borderLeft: selectedId === it.id ? 3 : 0,
                borderColor: 'primary.main',
              }}
            >
              <Typography variant="body2" fontWeight={600} noWrap>
                {it.title}
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.5 }}>
                <Chip
                  size="small"
                  label={paraLabel(it.para)}
                  color="primary"
                  variant="outlined"
                  title={`Group: ${paraLabel(it.para)}`}
                />
                <Chip size="small" label={it.kind} variant="outlined" />
                {it.project && (
                  <Chip
                    size="small"
                    icon={<FolderOutlinedIcon />}
                    label={it.project}
                    variant="outlined"
                    title={`Project: ${it.project}`}
                  />
                )}
              </Stack>
            </ListItemButton>
          ))}
        </List>
      </Box>
    </Paper>
  )
}
