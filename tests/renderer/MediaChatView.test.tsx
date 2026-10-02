import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MediaChatView } from '../../src/plugins/media-chat/MediaChatView'
import { lkvMock, makeIngestResult, makeItem, makeMessage, makePrompt, makeSession, makeVoicePack } from './lkv'

function seedMedia() {
  const lkv = lkvMock()
  lkv.prompts.list.mockResolvedValue([
    makePrompt('prm_media_reader', 'Media reader'),
    makePrompt('prm_desk', 'Desk cohost'),
  ])
  lkv.media.listVoicePacks.mockResolvedValue([makeVoicePack('prm_desk', 'Desk cohost')])
  lkv.media.listProjects.mockResolvedValue([])
  lkv.media.youtubeEmbedUrl.mockResolvedValue(null)
  lkv.media.pickLocal.mockResolvedValue({ canceled: false, mediaPath: '/tmp/video.mp4', captionsPath: '/tmp/video.vtt' })
  lkv.media.ingestLocal.mockResolvedValue(makeIngestResult({ mediaPath: '/tmp/video.mp4' }))
  lkv.chat.createSession.mockResolvedValue(makeSession('s_1'))
  lkv.chat.send.mockResolvedValue({
    assistant: makeMessage(),
    messages: [
      makeMessage({ id: 'msg_user', role: 'user', content: 'What is this about?' }),
      makeMessage({
        id: 'msg_asst',
        role: 'assistant',
        content: 'It is about otters.',
        citations_json: JSON.stringify([{ id: 'itm_1', title: 'Transcript' }]),
      }),
    ],
    session: makeSession('s_1'),
    offline: false,
  })
  return lkv
}

async function ingestYoutube() {
  const lkv = seedMedia()
  lkv.media.ingestYoutube.mockResolvedValue(
    makeIngestResult({ sourceType: 'youtube', mediaUrl: 'https://www.youtube.com/watch?v=abc123' }),
  )
  render(<MediaChatView />)
  fireEvent.change(screen.getByPlaceholderText(/youtube.com\/watch/), { target: { value: 'https://youtube.com/watch?v=abc123' } })
  fireEvent.click(screen.getByText('Ingest YouTube'))
  await screen.findByText(/Ingested 10 transcript notes/)
  return lkv
}

describe('MediaChatView', () => {
  it('renders the ingest form and empty state', () => {
    seedMedia()
    render(<MediaChatView />)
    expect(screen.getByText('Media chat')).toBeInTheDocument()
    expect(screen.getByText('Local video/audio + captions')).toBeInTheDocument()
    expect(screen.getByText(/Ingest a local file \+ captions/)).toBeInTheDocument()
  })

  it('ingests a YouTube URL', async () => {
    await ingestYoutube()
    expect(window.lkv.media.ingestYoutube).toHaveBeenCalledWith({ url: 'https://youtube.com/watch?v=abc123' })
  })

  it('rejects an empty YouTube URL', async () => {
    seedMedia()
    render(<MediaChatView />)
    fireEvent.click(screen.getByText('Ingest YouTube'))
    await waitFor(() => expect(screen.getByText('Paste a YouTube URL first')).toBeInTheDocument())
  })

  it('ingests a local file with captions', async () => {
    const lkv = seedMedia()
    render(<MediaChatView />)
    fireEvent.click(screen.getByText('Local video/audio + captions'))
    await waitFor(() => expect(lkv.media.ingestLocal).toHaveBeenCalled())
  })

  it('errors when local ingest lacks captions', async () => {
    const lkv = seedMedia()
    lkv.media.pickLocal.mockResolvedValue({ canceled: false, mediaPath: '/tmp/video.mp4' })
    render(<MediaChatView />)
    fireEvent.click(screen.getByText('Local video/audio + captions'))
    await waitFor(() => expect(screen.getByText(/Captions \(.srt \/ .vtt\) are required/)).toBeInTheDocument())
  })

  it('sends a chat message and renders citations', async () => {
    await ingestYoutube()
    fireEvent.change(screen.getByPlaceholderText('Ask about this media…'), { target: { value: 'What is this about?' } })
    fireEvent.click(screen.getByLabelText('Send'))

    await waitFor(() => expect(screen.getByText('It is about otters.')).toBeInTheDocument())
    expect(screen.getByText('Transcript')).toBeInTheDocument()
    expect(window.lkv.chat.send).toHaveBeenCalled()
  })

  it('restores the question when a media send fails', async () => {
    const lkv = await ingestYoutube()
    lkv.chat.send.mockRejectedValue(new Error('boom'))

    fireEvent.change(screen.getByPlaceholderText('Ask about this media…'), { target: { value: 'hi there' } })
    fireEvent.click(screen.getByLabelText('Send'))

    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument())
    expect(screen.getByPlaceholderText('Ask about this media…')).toHaveValue('hi there')
  })

  it('switches voice', async () => {
    await ingestYoutube()
    const chip = await screen.findByText('Desk cohost')
    fireEvent.click(chip)
    await waitFor(() => expect(screen.getByText(/Voice: Desk cohost/)).toBeInTheDocument())
  })

  it('opens fullscreen', async () => {
    await ingestYoutube()
    fireEvent.click(screen.getByLabelText('Enter fullscreen'))
    await screen.findByLabelText('Exit fullscreen')
  })

  it('clicks a citation to open the note and seek', async () => {
    const lkv = await ingestYoutube()
    lkv.items.get.mockResolvedValue(makeItem('itm_1', { body: 't_start: 120\nsome text' }))

    fireEvent.change(screen.getByPlaceholderText('Ask about this media…'), { target: { value: 'hi' } })
    fireEvent.click(screen.getByLabelText('Send'))
    const citation = await screen.findByText('Transcript')
    fireEvent.click(citation)

    await waitFor(() => expect(lkv.items.get).toHaveBeenCalledWith('itm_1'))
  })

  it('embeds YouTube without an origin= param (#117)', async () => {
    const lkv = seedMedia()
    const embed = 'https://www.youtube-nocookie.com/embed/abc123abc12?enablejsapi=1'
    lkv.media.youtubeEmbedUrl.mockResolvedValue(embed)
    lkv.media.ingestYoutube.mockResolvedValue(
      makeIngestResult({ sourceType: 'youtube', mediaUrl: 'https://www.youtube.com/watch?v=abc123abc12' }),
    )
    const { container } = render(<MediaChatView />)
    fireEvent.change(screen.getByPlaceholderText(/youtube.com\/watch/), {
      target: { value: 'https://youtube.com/watch?v=abc123abc12' },
    })
    fireEvent.click(screen.getByText('Ingest YouTube'))
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull())
    const src = container.querySelector('iframe')!.getAttribute('src')!
    expect(src).toBe(embed)
    expect(new URL(src).searchParams.has('origin')).toBe(false)
  })

  it('loads a media project from the select', async () => {
    const lkv = seedMedia()
    lkv.media.listProjects.mockResolvedValue([
      {
        project: 'My podcast',
        noteCount: 12,
        sourceType: 'local',
        mediaProtocolUrl: 'lkvmedia://podcast',
        updatedAt: '2026-09-28T00:00:00.000Z',
      },
    ])
    lkv.profiles.list.mockResolvedValue([])
    render(<MediaChatView />)

    fireEvent.mouseDown(await screen.findByLabelText('Open media project'))
    fireEvent.click(screen.getByRole('option', { name: /My podcast/ }))
    await waitFor(() => expect(screen.getByText(/Loaded media project/)).toBeInTheDocument())
  })

  it('renames the active media project', async () => {
    await ingestYoutube()
    fireEvent.click(screen.getByText('Rename'))
    fireEvent.change(screen.getByLabelText('Rename media project'), {
      target: { value: 'Renamed podcast' },
    })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() =>
      expect(window.lkv.projects.rename).toHaveBeenCalledWith('My podcast', 'Renamed podcast'),
    )
  })

  it('deletes the active media project after confirm', async () => {
    await ingestYoutube()
    fireEvent.click(screen.getByText('Delete'))
    await waitFor(() => expect(window.lkv.projects.delete).toHaveBeenCalledWith('My podcast'))
  })

  it('confirms before a re-ingest replaces an existing project', async () => {
    const lkv = seedMedia()
    lkv.media.findExistingProject.mockResolvedValue({ project: 'My podcast', noteCount: 10 })
    render(<MediaChatView />)
    fireEvent.click(screen.getByText('Local video/audio + captions'))
    await waitFor(() => expect(window.confirm).toHaveBeenCalled())
    await waitFor(() => expect(lkv.media.ingestLocal).toHaveBeenCalled())
  })
})
