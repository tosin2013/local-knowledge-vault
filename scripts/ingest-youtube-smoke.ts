import { closeDb, initDb, listItems } from '../electron/db'
import { ingestYoutubeMedia, resolveYtDlp } from '../electron/media-ingest'

const dbPath = '/home/box/.config/local-knowledge-vault/lkv.sqlite'
const url = process.argv[2] || 'https://www.youtube.com/watch?v=O2XTdl4PizE'
const captionsPath = process.argv[3]

initDb(dbPath)
try {
  console.log('yt-dlp:', resolveYtDlp())
  console.log('ingest:', url, captionsPath || '(live yt-dlp)')
  const result = ingestYoutubeMedia({
    url,
    ...(captionsPath ? { captionsPath } : {}),
  })
  console.log(
    JSON.stringify(
      {
        project: result.project,
        title: result.title,
        noteCount: result.noteCount,
        profileId: result.profileId,
        promptId: result.promptId,
        sourceType: result.sourceType,
        mediaUrl: result.mediaUrl,
        sampleIds: result.itemIds.slice(0, 3),
      },
      null,
      2
    )
  )
  const notes = listItems({ project: result.project, kind: 'transcript' })
  console.log('db transcript notes:', notes.length)
  if (notes[0]) {
    console.log('first title:', notes[0].title)
    console.log('first summary:', (notes[0].summary || '').slice(0, 160))
  }
} finally {
  closeDb()
}
