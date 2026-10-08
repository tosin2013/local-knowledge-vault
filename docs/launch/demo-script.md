# Vault demo: recording kit

Target: a **30–40 second** screen recording of Vault on macOS, exported as
`docs/media/vault-demo.mp4` (under 15 MB) and `docs/media/vault-demo.gif` (about 960 px wide,
8 MB or less) for the README hero.

The story in one line: **local model → ask → cited answer → open the source → honest "I don't
know."**

---

## 1. Prepare (off camera, ~10 minutes)

### Model

```bash
brew install ollama        # or install the Ollama app from https://ollama.com
ollama pull qwen3:8b
ollama run qwen3:8b "hi"   # warm the model so the first answer isn't slow on camera
```

### A clean demo profile

Use a throwaway profile so the notes list and chat history are clean and no API keys exist:

```bash
# Installed app
LKV_USER_DATA_DIR="$HOME/VaultDemo" /Applications/Vault.app/Contents/MacOS/Vault

# Or from source
LKV_USER_DATA_DIR="$HOME/VaultDemo" npm run dev
```

A fresh profile starts in **Auto (local first)** and seeds the self-documenting **Vault guide**
project (nine notes that teach PARA, kinds, citations, projects and Media chat). Leave them; they
make the notes rail look lived-in. Check that the header chip reads **`Local · Ollama · qwen3:8b`**.

### Seed a small public-domain sample

Vault answers from roughly the first 1,200 characters of each matching note, so **several short
notes demo better than one long page**. Create these three notes with **New note** (title +
body; paste the text exactly). The text is from *The Autobiography of Benjamin Franklin*, public
domain, [Project Gutenberg eBook #20203](https://www.gutenberg.org/ebooks/20203).

**Note A: title `Franklin's thirteen virtues (1–7)`**

```
From The Autobiography of Benjamin Franklin (public domain, Project Gutenberg eBook #20203).

These names of virtues, with their precepts, were:

1. Temperance. Eat not to dullness; drink not to elevation.
2. Silence. Speak not but what may benefit others or yourself; avoid trifling conversation.
3. Order. Let all your things have their places; let each part of your business have its time.
4. Resolution. Resolve to perform what you ought; perform without fail what you resolve.
5. Frugality. Make no expense but to do good to others or yourself; i. e., waste nothing.
6. Industry. Lose no time; be always employ'd in something useful; cut off all unnecessary actions.
7. Sincerity. Use no hurtful deceit; think innocently and justly; and, if you speak, speak accordingly.
```

**Note B: title `Franklin's virtues (8–13) and his little book`**

```
From The Autobiography of Benjamin Franklin (public domain, Project Gutenberg eBook #20203).

8. Justice. Wrong none by doing injuries, or omitting the benefits that are your duty.
9. Moderation. Avoid extreams; forbear resenting injuries so much as you think they deserve.
10. Cleanliness. Tolerate no uncleanliness in body, cloaths, or habitation.
11. Tranquillity. Be not disturbed at trifles, or at accidents common or unavoidable.
12. Chastity. Rarely use venery but for Health or Offspring; Never to Dulness, Weakness, or the Injury of your own or another's Peace or Reputation.
13. Humility. Imitate Jesus and Socrates.

I judg'd it would be well not to distract my attention by attempting the whole at once, but to fix it on one of them at a time. I made a little book, in which I allotted a page for each of the virtues. I rul'd each page with red ink, so as to have seven columns, one for each day of the week, and I might mark, by a little black spot, every fault I found upon examination to have been committed respecting that virtue upon that day.
```

**Note C: title `Franklin's daily schedule`**

```
From The Autobiography of Benjamin Franklin (public domain, Project Gutenberg eBook #20203).

The precept of Order requiring that every part of my business should have its allotted time, one page in my little book contain'd the following scheme of employment for the twenty-four hours of a natural day.

The Morning. Question: What good shall I do this day?
5-7: Rise, wash, and address Powerful Goodness! Contrive day's business, and take the resolution of the day; prosecute the present study, and breakfast.
8-11: Work.
Noon. 12-1: Read, or overlook my accounts, and dine.
2-5: Work.
Evening. Question: What good have I done to-day?
6-9: Put things in their places. Supper. Music or diversion, or conversation. Examination of the day.
Night. 10-4: Sleep.
```

Optional, to show **Add from URL** (turn on **Advanced**, paste into the sidebar field, press
**Import**): `https://www.gutenberg.org/files/1/1-h/1-h.htm` (Project Gutenberg eBook #1, the
Declaration of Independence, with Michael Hart's introduction). It works for "When was the first
Project Gutenberg e-text released?" (early 1971). Avoid importing a whole book page: Vault keeps
the first 12,000 characters, and a Gutenberg book starts with license boilerplate.

### Example questions (rehearse each once before recording)

| Purpose | Question | What a good answer shows |
|---|---|---|
| Cited answer (main shot) | `What did Franklin mean by Order, and how did he plan his day?` | Order precept + the 5 a.m. schedule, with numbered citations ([1], [2]) for Note A and Note C |
| Backup cited answer | `What question did Franklin ask himself every morning and evening?` | "What good shall I do this day?" / "What good have I done to-day?" cited to Note C |
| Backup cited answer | `How did Franklin track his faults?` | The little book, red-ink columns, black spots, cited to Note B |
| Honest "I don't know" | `What is the recommended daily dose of vitamin D?` | A plain statement that the notes don't cover it, with no citations |

Keyword search matches common words too, so the "I don't know" question still reaches the model
with some Franklin passages; the grounding rules tell it to say the notes don't cover the question.
Rehearse it with the exact model you'll record with. If the model answers from general knowledge
anyway, start a **New chat** for that question and try again, or pick a question further from the
notes (for example `Who won the 2018 FIFA World Cup?`).

Do a full dry run, then click **New chat** so the recorded session starts empty.

---

## 2. Shot list (about 36 seconds)

| Time | Shot | On screen | Notes |
|---|---|---|---|
| 0:00–0:04 | Open | Vault on the **Ask** home, notes rail visible. Move the pointer over the header chip **`Local · Ollama · qwen3:8b`** and pause. | This is the "local by default" beat. |
| 0:04–0:10 | Ask | Click the Ask box and type `What did Franklin mean by Order, and how did he plan his day?` at a steady pace. Press Enter. | Type slowly; viewers read along. |
| 0:10–0:17 | Cited answer | The answer appears with numbered citations (**[1]**, **[2]**) in the text and matching source chips under it. Hover over one. | If generation takes long, keep it or cut the wait in editing; don't speed it up. |
| 0:17–0:22 | Source | Click a citation. The **note peek** opens beside the chat with Franklin's text. Pause 2 s, then close it. | Proves the answer came from your note. |
| 0:22–0:31 | Honest IDK | Type `What is the recommended daily dose of vitamin D?` and press Enter. The answer says the notes don't cover it. No citations. | Let it sit for 2 s. |
| 0:31–0:34 | Optional flash | Click the AI chip → **Add provider** → open the preset list (OpenAI, Anthropic, Gemini, …) → **Cancel**. Or **Plugins → Add-ons…** for 2 s. | Choose one. Never show a key field with a real key in it. |
| 0:34–0:36 | End | Back on the answer. Hold still. | Leave a clean last frame; the GIF loops. |

---

## 3. Record on a Mac

1. **Clean up.** Hide desktop icons (`defaults write com.apple.finder CreateDesktop false; killall
   Finder`, undo with `true`), turn on Do Not Disturb, quit apps that pop notifications, close
   other windows. Use Vault's dark theme.
2. **Size the window to about 1280×800.** Drag the corner, or run (needs Accessibility permission
   for Terminal):
   ```bash
   osascript -e 'tell application "System Events" to tell process "Vault" to set size of front window to {1280, 800}'
   ```
3. **Make text bigger.** Use **View → Zoom In** (Cmd +) once in Vault; **View → Actual Size**
   (Cmd 0) resets it. Check nothing important gets cut off at 1280×800.
4. **Start recording.** Press **Cmd+Shift+5** → choose **Record Selected Portion** → drag the
   frame to fit the Vault window exactly. Under **Options**, turn on **Show Mouse Clicks**, set
   **Save to** Desktop, and pick a microphone only if you're doing the voiceover live.
   Click **Record**.
5. **Perform the shot list** slowly and deliberately. Pause briefly between beats.
6. **Stop** with the stop button in the menu bar (or **Cmd+Ctrl+Esc**). The file lands on the
   Desktop as `Screen Recording <date> at <time>.mov`.

Checklist before you stop: no API keys, no personal notes, no notifications, no email or
browser tabs on screen.

---

## 4. Convert (Homebrew ffmpeg)

```bash
brew install ffmpeg
cd ~/path/to/local-knowledge-vault
mv ~/Desktop/Screen\ Recording*.mov ~/vault-raw.mov   # if there are several, pick the right one
```

**Web MP4 (H.264, 1280 px wide, 30 fps, no audio, capped bitrate so a 40 s clip stays under 15 MB):**

```bash
ffmpeg -i ~/vault-raw.mov -vf "fps=30,scale=1280:-2:flags=lanczos" -c:v libx264 -preset slow -crf 23 -maxrate 2500k -bufsize 5000k -pix_fmt yuv420p -movflags +faststart -an docs/media/vault-demo.mp4
```

Keeping a voiceover? Replace `-an` with `-c:a aac -b:a 128k`.

**GIF (960 px wide, 12 fps, palettegen/paletteuse, target 8 MB or less):**

```bash
ffmpeg -i ~/vault-raw.mov -vf "fps=12,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 docs/media/vault-demo.gif
```

Check sizes with `ls -lh docs/media/vault-demo.*`. If the GIF is over 8 MB, trim the ends and
lower fps, width and colors:

```bash
ffmpeg -ss 1 -to 35 -i ~/vault-raw.mov -vf "fps=10,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 docs/media/vault-demo.gif
```

`-ss`/`-to` (seconds, before `-i`) also trim the MP4. These commands were tested with ffmpeg 7.1
on a synthetic 35 s, 2560×1600, 60 fps clip (a Retina-sized capture): the MP4 came out at
1.4 MB (1280×800, 30 fps) and the GIF at 5.4 MB (960×600, 12 fps). A real UI recording has
more changing pixels, so expect larger files, still within the targets for 30–40 s.

---

## 5. Put the files in the repo and commit

1. Files go in:
   - `docs/media/vault-demo.mp4`
   - `docs/media/vault-demo.gif`
2. In `README.md`, find `<!-- DEMO: replace docs/media/vault-demo.gif after recording -->` and
   replace the `<p align="center">…</p>` block under it with the ready-made line in the comment:
   ```html
   <p align="center"><a href="docs/media/vault-demo.mp4"><img src="docs/media/vault-demo.gif" alt="Vault demo: ask a question, click a citation, get an honest I don't know" width="860"></a></p>
   ```
3. Commit and push:
   ```bash
   git add docs/media/vault-demo.mp4 docs/media/vault-demo.gif README.md
   git commit -m "Add demo video and GIF to README"
   git push origin main
   ```

Tip: GitHub doesn't play a repo MP4 inline in a README. If you want an inline player, drag the MP4
into the README editor on github.com (or into an issue comment) and use the
`https://github.com/user-attachments/...` URL it gives you. The GIF works everywhere as is.

---

## 6. Optional 30-second voiceover (~75 words)

> This is Vault. It runs on a local model: here, Qwen3 8B through Ollama.
> I'll ask what Franklin meant by Order. The answer comes only from my notes,
> and every point carries a citation. Click one, and there's the source note.
> Now something my notes don't cover: vitamin D. Vault says it doesn't know,
> instead of making something up.
> Want a cloud model or a plugin? Add one in a few clicks. Either way, your notes are stored on your machine.
