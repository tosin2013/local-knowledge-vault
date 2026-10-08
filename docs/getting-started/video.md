# Learning from video

**Who this is for:** you learn from lectures, talks, interviews or podcasts, on YouTube or saved
on your computer, and you want to ask questions about them and jump straight to the moment an
answer came from.

**In about 10 minutes you'll have:** one video turned into searchable transcript notes, a cited
answer about it, and a citation that moves the player to the right moment.

## 1. Install

Download Vault from the
[Releases page](https://github.com/tosin2013/local-knowledge-vault/releases) and open it. The
[README](../../README.md#download) has the macOS and Linux first-run notes.

**For YouTube you also need [`yt-dlp`](https://github.com/yt-dlp/yt-dlp),** the tool Vault uses
to fetch captions. The recommended install includes the browser impersonation that avoids YouTube
"too many requests" (HTTP 429) errors:

```bash
pipx install "yt-dlp[default,curl-cffi]"
```

On Linux, use the `.deb`, `.rpm` or AppImage build for YouTube: the confined `.snap` can't reach a
`yt-dlp` installed outside it. Local video and audio files don't need `yt-dlp` at all.

## 2. Set up a model

Any model works. Locally, install [Ollama](https://ollama.com) and run `ollama pull qwen3:8b`.
Otherwise see [Quickest setup with a cloud model](cloud-quickstart.md). Bringing a video in
doesn't need a model. Asking about it does.

## 3. Your first session

1. **Open Media chat.** Click **Media chat** at the top of the window. It's also under
   **Plugins**.
2. **Bring in a video.** Under **Ingest**, either:
   - paste a YouTube link into the box that shows `https://youtube.com/watch?v=…` and click
     **Ingest YouTube**, or
   - click **Local video/audio + captions** and pick a video or audio file. If a `.srt` or `.vtt`
     file with the same name sits next to it, Vault uses it. Otherwise it asks you to choose the
     captions file.

   A progress bar shows each stage, with **Cancel**. The captions become timed transcript notes
   in a project named after the video.
3. **Ask about it.** Type in the box that says **Ask about this media…** and press Enter. The answer
   cites transcript notes, each covering a stretch of the video.
4. **Jump to the moment.** Click a citation. The player seeks to that part of the video, for
   YouTube and local files alike.
5. **Ask about what's on screen.** Type a question and click **Ask about this moment** to ask
   about the part of the video at the playhead. **Follow playhead** is on by default, so every
   question also carries the current time. Switch it off to ask about the whole video.
6. **Keep what matters.** Two buttons open a new note marked **AI draft**. Click **Save** in it to
   keep it.
   - **Save this moment** saves the transcript from about 45 seconds either side of the playhead,
     with the video's link and time range.
   - **Save as note** under an answer saves that answer.
7. **Come back later.** Pick the video from **Open media project**.

## 4. What to expect

- **Cited answers from the transcript,** with a seekable citation for each point.
- **Honest gaps:** if the video doesn't cover your question, the answer says so.
- **The transcript is part of your vault.** Ask (the main screen) can use it too, ranked after
  your own notes. The **Transcripts** switch in the notes list shows or hides transcript notes.
- **Voices:** voice chips in Media chat switch the speaking style (**Media reader** by default). Add
  ready-made ones (**Desk cohost**, **Curious student**, **Skeptical investor**) or your own under
  **Plugins → Media voices**. A voice changes style only, never the citation rules.

## 5. Tips and limits

- **Captions are required.** Vault doesn't transcribe audio itself. YouTube videos need English
  captions (uploaded or auto-generated). For local files, bring an `.srt` or `.vtt`.
- **YouTube errors:** if YouTube keeps refusing (HTTP 429), update `yt-dlp` with the install line
  above. Or set `LKV_YTDLP_EXTRA_ARGS="--cookies-from-browser firefox"` before starting Vault to
  use your browser's YouTube session. Local captions always work.
- **Bringing the same video in again** replaces its transcript notes, and old citations to those
  notes stop working. Vault asks before it does this.
- **What goes online:** only YouTube links contact YouTube (through `yt-dlp` and the embedded
  player). Local files stay on your computer.
- Player and chat can go fullscreen together with the fullscreen button.

## Next steps

- [Students and exam prep](students.md): turn lecture notes into recall practice and spaced
  review.
- [PLUGINS.md](../../PLUGINS.md#media-chat-first-plugin): Media chat and Media voices in detail.
