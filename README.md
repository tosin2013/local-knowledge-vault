# Vault

[![codecov](https://codecov.io/gh/tosin2013/local-knowledge-vault/graph/badge.svg)](https://app.codecov.io/gh/tosin2013/local-knowledge-vault)

**Chat with your notes on your own computer. Every answer cites the note it came from, or says it doesn't know.**

Vault (Local Knowledge Vault) is a desktop app for macOS, Windows and Linux. Your notes stay in a
local SQLite database. Answers come from a local model by default (Ollama or LM Studio, detected
automatically), and you can add a cloud provider or a shareable plugin in a few clicks.

<!-- DEMO: replace docs/media/vault-demo.gif after recording -->
<!-- After recording, replace the <p> below with:
<p align="center"><a href="docs/media/vault-demo.mp4"><img src="docs/media/vault-demo.gif" alt="Vault demo: ask a question, click a citation, get an honest I don't know" width="860"></a></p>
-->
<p align="center">
  <img src="docs/media/vault-ask-citation.png" alt="Vault answering from a book note, with a citation that opens the source note" width="860">
  <br>
  <sub>An answer with its citation. (This screenshot predates numbered citations and used a cloud provider; new installs use a local model first.)</sub>
</p>

## Download

Installers are on the
**[Releases page](https://github.com/tosin2013/local-knowledge-vault/releases)**: `.dmg`/`.zip`
for macOS (Intel and Apple silicon), an NSIS `.exe` for Windows, and `.AppImage`/`.deb`/`.rpm`/`.snap`
for Linux. You can also [build from source](#build-from-source).

**Linux:** on Ubuntu/Debian run `sudo apt install ./local-knowledge-vault_*_amd64.deb`; on Fedora run
`sudo dnf install ./local-knowledge-vault-*.x86_64.rpm`. The snap is confined, so **Media chat** can't reach a
`yt-dlp` installed outside it; use the `.deb`, `.rpm` or AppImage if you need YouTube import.

**macOS: the app is not notarized yet.** The first time you open it, macOS says it can't verify
the app. Click **Done**, then go to **System Settings → Privacy & Security**, click **Open Anyway**
and confirm. You only need to do this once. On macOS 14 and earlier, right-click (or Control-click)
**Vault.app** → **Open** → **Open** also works.

If macOS says Vault "is damaged and can't be opened", remove the download quarantine flag and open
it again: `xattr -dr com.apple.quarantine /Applications/Vault.app`.

## Quick start (local first)

1. Install [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai).
2. Pull the recommended model:
   ```bash
   ollama pull qwen3:8b
   ```
   (about 5 GB; `llama3.1:8b` also works. In LM Studio, search for "Qwen3 8B" and load it.)
3. Open Vault. The header chip should read **`Local · Ollama · qwen3:8b`**. If no model is
   running, Vault shows a setup card with the command above and a **Re-check** button.
4. Add notes: **New note**, paste a link into **Add from URL**, or use **Import Markdown** or
   **Import book / PDF**. First launch also seeds a self-documenting **Vault guide** project so you
   can try it straight away.
5. Open **Ask** and ask a question. Click a numbered citation such as **[1]** to open the source note.

Prefer a cloud model? Click the AI chip → **Add provider**, pick a preset, paste your key, press
**Test connection**, then **Save**.

## Why Vault

- **Answers you can check.** Answers cite the notes they came from as numbered citations, **[1]**,
  **[2]**, with a matching list of sources. Citations to notes that weren't retrieved are dropped
  before you see them, and when your notes don't cover a question, Vault says so. An answer that
  cites none of your notes gets a **No notes cited** chip; an honest "not in your notes" doesn't.
- **Local by default.** Notes live in SQLite on your machine. With Ollama or LM Studio, your notes
  and questions stay on your computer (the only other request is an update check you can turn off;
  see [Privacy](#privacy)). Search works with no model and no network at all.
- **Any model you like.** Local models first, or OpenAI, Anthropic, Gemini, OpenRouter, Mistral,
  DeepSeek, Together, Groq, xAI, or any OpenAI-compatible URL.
- **Plugins you can share safely.** A plugin is a `plugin.json` folder or zip. It adds presets,
  voices and prompt packs, and it cannot run code.
- **Low ceremony.** Ask is the home screen. Simple mode hides the knobs; Advanced shows them.

## Features

### Ask with citations

Vault searches your notes, sends the matching passages to the model with fixed grounding rules,
and shows each citation as a number in the answer with a matching source chip below it. Clicking
either opens the note in a side peek, so your chat stays where it is. Answers can use simple
formatting (headings, lists, bold). If search finds nothing, you get "I couldn't find that in your notes" without a
model call. Chats are saved as sessions, and **Export citation pack** writes the thread, the cited
notes and a manifest to a folder or zip that you can hand to another LLM or a colleague.

### Local model setup that explains itself

<img src="docs/media/providers-first-run.png" alt="First-run card recommending ollama pull qwen3:8b" width="720">

With no model running, the first-run card recommends `qwen3:8b` and offers **Re-check** or
**Use a cloud model instead**. If you are running a very small model (under ~3B parameters),
Vault suggests a bigger one, because small models follow citation rules less reliably.

### Add your own provider

<img src="docs/media/providers-add-dialog.png" alt="Add provider dialog with presets, masked API key, Fetch models and Test connection" width="720">

Pick a preset or a custom OpenAI-compatible URL, fetch the live model list, and test the
connection before saving. Keys are write-only in the UI. They are stored encrypted with the
operating system's keychain where one is available; otherwise (for example Linux without a keyring)
they are saved as owner-only files, and AI providers tells you so.

### Declarative plugins

<img src="docs/media/providers-manage-plugins.png" alt="Add-ons screen with two installed plugin.json packs" width="720">

**Plugins → Add-ons…** installs a folder or `.zip`, shows what each pack contributes before you
accept it, and explains why a broken pack was rejected.

### More

- **Media chat.** Paste a YouTube URL (captions fetched with [`yt-dlp`](https://github.com/yt-dlp/yt-dlp),
  which must be installed; `pipx install "yt-dlp[default,curl-cffi]"` includes the browser
  impersonation that avoids YouTube 429 errors) or open a local video/audio file with its `.srt`/`.vtt` captions. Captions
  become timed transcript notes you can ask about. Clicking a citation seeks the player to that
  moment, for local media and YouTube embeds alike. Player and chat can go fullscreen together.
- **Media voices.** Reusable voices (Desk cohost, Curious student, Skeptical investor, or your
  own) that change the speaking style but keep the same grounding rules. One install works for
  every video.
- **Personalities and profiles** for Ask, plus note groups (Projects / Areas / Resources /
  Archives), kinds, status and project filters. Start a personality from a template, preview it
  against your own notes, and export or import it as a file. A personality changes tone and format
  only; the grounding and citation rules always apply. See [docs/personalities.md](docs/personalities.md).
- **Add from URL.** Fetches a public web page, extracts the text and auto-tags it as a note.
- **Import Markdown / Obsidian notes.** Point Vault at a folder and import its `.md` files as
  notes — title from frontmatter or the first heading, and PARA/project inferred from
  frontmatter, tags, or the folder structure. Obsidian `[[wiki links]]` are normalized to text.
- **Import books.** **Import book / PDF** turns an EPUB into one note per chapter and a PDF into
  notes by page range, all under a project named after the book. Covers, image-only pages and
  Project Gutenberg licence text are skipped.
- **Study mode** (**Plugins → Study**). Write what you remember first, then reveal the grounded,
  cited answer as feedback, rate your confidence and grade yourself. A calibration strip shows how
  well your confidence matches your results.
- **Spaced review** (**Plugins → Review**). Notes come back on a spaced schedule: recall, reveal the
  note, rate how it went.
- **Test to notes** (**Plugins → Test to notes**). Paste practice-test results and turn each wrong
  answer into a grounded corrective note.
- **AI drafts stay drafts.** Notes written by the model (for example from Test to notes) are saved as
  **AI draft** and rank below your own notes in search. To confirm one, edit it or write a one-line
  summary in your own words.
- **Trash.** Deleted notes go to Trash first, where you can restore them or empty it.
- **MCP client.** **Plugins → MCP connections → Connect Notion** signs in to Notion's hosted MCP
  server (`https://mcp.notion.com/mcp`) with OAuth and lists its tools. You can also add other
  Streamable HTTP MCP servers. Using MCP tools inside Ask is not wired up yet.
- **Obsidian bridge.** While Vault runs, it serves a small HTTP API on `127.0.0.1:8765`
  (`/health`, `/v1/projects`, `/v1/ask`; set `LKV_BRIDGE_PORT` to use another port). Every call
  except `/health` needs the bearer token shown in **AI providers → Vault Bridge**. A scaffold Obsidian plugin in
  [`bridges/obsidian-vault/`](bridges/obsidian-vault/) adds an **Ask Vault…** command that inserts
  the cited answer into your current note. See [docs/bridges.md](docs/bridges.md).
- **Simple and Advanced modes**, light and dark themes.

Retrieval is local keyword search (SQLite FTS5 with BM25 ranking). There are no embeddings, so
short, focused notes and questions that reuse their words work best.

## Bring any model

| Preset | Default model | Key |
|---|---|---|
| Ollama (local) | auto-picks an installed model | none |
| LM Studio (local) | the loaded model | none |
| OpenAI | `gpt-4o-mini` | required |
| Anthropic | `claude-haiku-4-5` | required |
| Google Gemini | `gemini-3.8-flash` | required |
| OpenRouter | `openrouter/auto` (`openrouter/free` for free models) | required |
| Mistral | `mistral-small-latest` | required |
| DeepSeek | `deepseek-flash` | required |
| Together | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | required |
| Groq | `openai/gpt-oss-20b` | required |
| xAI | `grok-4.3` | required |
| Custom | any OpenAI-compatible server (vLLM, llama.cpp server, LocalAI, Jan, gateways) | optional |

In **Auto (local first)** mode Vault tries Ollama, then LM Studio, then other local servers, then
enabled cloud providers that have a key, and marks an answer from a cloud provider as
"Cloud fallback". **Auto — local only** never uses a cloud provider. A disabled cloud provider is
never called. Model defaults
change often, so use **Fetch models** to pick from the provider's live list. Details, key storage
and environment variables: **[docs/providers.md](docs/providers.md)**.

<img src="docs/media/providers-list.png" alt="AI providers panel: local section (Ollama, LM Studio) and cloud section, used only when enabled" width="720">

## Plugins

A plugin is a folder with a `plugin.json` (plus optional Markdown and image files). It can add
provider presets, voices, quick-ask prompt packs and MCP server presets. It cannot run code, and
it cannot ship API keys or custom headers.

```json
{
  "schemaVersion": 1,
  "id": "study-buddy",
  "name": "Study buddy",
  "version": "1.0.0",
  "contributes": {
    "personas": [
      { "name": "Study buddy", "prompt": "Explain simply, then ask one quiz question from my notes." }
    ],
    "promptPacks": [
      { "name": "Revision", "prompts": ["Quiz me: ask 3 questions I should be able to answer from these notes."] }
    ]
  }
}
```

Install it from **Plugins → Add-ons… → Install folder…** (or **Install .zip…**). (`personas` is the
`plugin.json` key for what the app calls voices and personalities.) Full
reference: **[docs/plugins-authoring.md](docs/plugins-authoring.md)**. Examples:
[`examples/plugins/`](examples/plugins/). Built-in panels are documented in
[PLUGINS.md](PLUGINS.md).

## How it compares

|  | Vault | Obsidian + AI community plugins | Notion AI | AnythingLLM |
|---|---|---|---|---|
| Where your notes live | SQLite on your computer | Markdown files on your device | Notion's cloud workspace | On your computer (desktop) or your own server |
| AI | Built in: grounded Ask over your notes | Through community plugins; behavior varies by plugin | Built in (Business/Enterprise plans; limited trial on Free/Plus) | Built in: chat with documents, agents |
| Models | Local first (Ollama, LM Studio), or add a cloud provider | Depends on the plugin | Models Notion offers, via its model picker | Local on-device models, with model selection |
| Best at | Cited answers from personal notes and video captions, one user | Flexible linked notes, thousands of plugins, sync and publish | Team docs, databases and collaboration | A broad local AI workspace, including multi-user self-hosting |

Where Vault is weaker today: no semantic (embedding) search, single user, no mobile app, no sync,
and a much smaller plugin ecosystem. Obsidian and Vault can work together through the bridge.

## Privacy

Your data lives in Vault's user-data folder:

| OS | Folder |
|---|---|
| macOS | `~/Library/Application Support/local-knowledge-vault` |
| Windows | `%APPDATA%\local-knowledge-vault` |
| Linux | `~/.config/local-knowledge-vault` |

It holds the notes database (`lkv.sqlite`), provider settings (`lkv-providers.json`), API keys
(`lkv-keys/`), the bridge token and plugins (`plugins/`). Keys and tokens are encrypted with the OS
keychain via Electron `safeStorage` where available, and older plaintext ones are encrypted the next
time Vault starts. Without a keychain (for example Linux with no keyring) they stay owner-only
files, and AI providers shows a notice. Set `LKV_USER_DATA_DIR` to use another folder.

What leaves your machine:

- **With a local model: none of your notes or questions.** Health checks only ping local servers.
- **Update check:** on launch, installed builds make one request to GitHub for the latest release
  version and show a notice if a newer one exists. It sends nothing about you or your notes, and
  nothing is downloaded. Turn it off in **Settings → Updates**.
- **With a cloud provider you enabled:** your question, the matching note passages and recent chat
  turns go to that provider only. Cloud providers are not contacted until you ask something.
- **Add from URL** fetches the page you give it. Vault asks the active model to auto-tag it, so if
  that is a cloud provider it receives an excerpt of the page.
- **Media chat** contacts YouTube (through `yt-dlp` and the embedded player) only for YouTube media.
- **Notion** is contacted only if you connect it under MCP connections.
- The Obsidian bridge listens on `127.0.0.1` only and requires a per-install bearer token (shown
  in **AI providers → Vault Bridge**). Do not expose or port-forward that port.

## Build from source

Requires **Node.js 22.22.2 or newer** (the dependency tree — `electron@44`, `better-sqlite3@13`,
`jsdom@30` — needs Node 22; run `nvm use` to pick up the pinned version). `better-sqlite3` is a
native module compiled for your Node during install; on Linux you need `python3`, `make` and `g++`
(e.g. `sudo apt install build-essential python3`).

```bash
git clone https://github.com/tosin2013/local-knowledge-vault.git
cd local-knowledge-vault
npm install          # also rebuilds better-sqlite3 for Electron
npm run dev          # Electron + Vite with hot reload
```

Checks (no GUI needed):

```bash
npm run typecheck
npm run test:ci             # every Electron-side smoke suite in scripts/ (what CI runs)
npm run test:renderer       # React UI tests (Vitest + jsdom, tests/renderer/)
npm run test:mvp            # one suite on its own: database, search, citation validation
```

Installers:

```bash
npm run dist:mac     # dmg + zip (on macOS)
npm run dist:win     # NSIS installer (on Windows)
npm run dist:linux   # AppImage + deb + rpm + snap (on Linux)
```

More (layout, IPC API, environment variables, all test scripts):
**[docs/development.md](docs/development.md)**. Releases: [docs/release.md](docs/release.md).

## Roadmap

- **Vault as an MCP server**, so AI agents can use your notes as cited memory.
- **Signed and notarized macOS builds.**
- **Code plugins** later, behind a permission model. Plugins stay declarative for now.

## Ways to help

New here? The smallest, most self-contained places to start:

- **[Good first issues](https://github.com/tosin2013/local-knowledge-vault/labels/good%20first%20issue)** —
  bounded docs and tooling tasks, each with a clear "done" bar. The study tooling (de-identified log
  export, pre-registration templates) lives here.
- **[Help wanted](https://github.com/tosin2013/local-knowledge-vault/labels/help%20wanted)** — larger,
  still well-scoped.
- **Help measure whether this works.** Vault now has recall-first Study mode, spaced review and a
  calibration strip, but no learning data yet. The [learning & retention
  study](docs/local-knowledge-vault-study-effects-on-learning.md) is the pre-registered plan (#218).
- Read [CONTRIBUTING.md](CONTRIBUTING.md) for branch naming and the checks CI runs.

Vault is maintained by one person, so a small, focused pull request that follows `CONTRIBUTING.md` is
the fastest way to get a change merged.

## Contributing

Issues and pull requests are welcome. Please include your OS, the model or provider you used, and
steps to reproduce. Before opening a PR, run `npm run typecheck` and the relevant `npm run test:*`
scripts. For plugin ideas, start with a `plugin.json` pack; see
[docs/plugins-authoring.md](docs/plugins-authoring.md).

## License

Vault is licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attributions.

Built by Tosin Akinosho ([@tosin2013](https://github.com/tosin2013)).
