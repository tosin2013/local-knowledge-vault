import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material'
import type { AskGroundedResult, ItemFilters, SearchHit } from '../../electron/types'
import { paraLabel } from '../domain'

export interface FindPanelProps {
  advanced: boolean
  askResult: AskGroundedResult | null
  hits: SearchHit[]
  searchText: string
  filters: ItemFilters
  filterSummary: string
  hasMore: boolean
  onSelect: (id: string) => void
  onAskInstead: () => void
  onShowMore: () => void
}

export function FindPanel(props: FindPanelProps) {
  const { advanced, askResult, hits, searchText, filters, filterSummary, hasMore, onSelect, onAskInstead, onShowMore } = props

  return (
    <Box className="panel" sx={{ p: 2 }}>
      {askResult && (
        <>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            Answer
          </Typography>
          {askResult.offline && (
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              AI unavailable — search hits still shown.
            </Alert>
          )}
          <Paper sx={{ p: 2, mb: 1.5, borderRadius: 4, bgcolor: 'background.paper', whiteSpace: 'pre-wrap' }}>
            <Typography variant="body2">{askResult.answer}</Typography>
          </Paper>
          {askResult.citations.length > 0 && (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                From your notes
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
                {askResult.citations.map((c) => (
                  <Chip
                    key={c.id}
                    label={c.title}
                    color="primary"
                    variant="outlined"
                    onClick={() => onSelect(c.id)}
                    title={advanced ? c.id : c.project && !c.title.includes(c.project) ? `${c.title} — ${c.project}` : c.title}
                  />
                ))}
              </Stack>
            </>
          )}
        </>
      )}

      <Typography variant="subtitle1" fontWeight={600} sx={{ mt: askResult ? 1 : 0, mb: 0.5 }}>
        {hits.length > 0 ? `Results (${hits.length})` : 'Results'}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.25 }}>
        {filterSummary === 'All notes'
          ? 'All notes'
          : `Filtering by ${filterSummary}`}
      </Typography>
      {hits.length === 0 ? (
        <Stack alignItems="center" spacing={1.5} sx={{ p: 4, color: 'text.secondary' }}>
          <Typography variant="body2">
            {searchText.trim() || filters.para || filters.kind || filters.status || filters.project
              ? 'No notes match these filters'
              : 'Search to find notes, or switch to Ask with your question.'}
          </Typography>
          <Button variant="contained" onClick={onAskInstead}>
            Ask instead
          </Button>
        </Stack>
      ) : (
        <Stack spacing={1}>
          {hits.map((h) => (
            <Paper
              key={h.id}
              component="button"
              onClick={() => onSelect(h.id)}
              sx={{
                p: 1.5,
                textAlign: 'left',
                cursor: 'pointer',
                borderRadius: 4,
                border: 1,
                borderColor: 'divider',
                bgcolor: 'background.paper',
                '&:hover': { borderColor: 'primary.main' },
              }}
            >
              <Typography variant="body2" fontWeight={600}>
                {h.title}{' '}
                <Typography component="span" variant="caption" color="text.secondary" fontWeight={400}>
                  {h.project && !h.title.includes(h.project) && <>{h.project} · </>}
                  {advanced && <>score {h.score.toFixed(2)} · </>}
                  {paraLabel(h.para)}
                </Typography>
              </Typography>
              <Typography className="snippet" variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {h.snippet}
              </Typography>
            </Paper>
          ))}
          {hasMore && (
            <Button size="small" onClick={onShowMore} sx={{ alignSelf: 'flex-start' }}>
              Show more
            </Button>
          )}
        </Stack>
      )}
    </Box>
  )
}
