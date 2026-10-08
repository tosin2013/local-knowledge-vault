# Developing Vault

Notes for people building or hacking on Vault (Local Knowledge Vault). The user-facing overview
is in the [README](../README.md).

## Stack

- **Electron 44** main process (`electron/`): SQLite via `better-sqlite3`, IPC, provider registry,
  plugin loader, MCP client, local HTTP bridge.
- **React 19 + Vite 8 + TypeScript 7** renderer (`src/`), MUI components.
- **electron-builder** for installers.

**Node 22.22.2+ required** (pinned in `.nvmrc`). `npm ci` compiles `better-sqlite3` for your Node, so
Linux needs `python3`, `make` and `g++` (`sudo apt install build-essential python3`).

## Layout

```
local-knowledge-vault/
  electron/
    main.ts             # Electron lifecycle + IPC handlers
    preload.ts          # contextBridge → window.lkv
    db.ts               # schema, FTS5 triggers, CRUD, first-launch seed notes
    search.ts           # metadata filters + FTS5 (BM25) query
    generate.ts         # grounded Ask + citation validation (drops unknown itm_ ids)
    chat.ts             # chat sessions (grounded, with recent history)
    llm.ts              # provider resolution (local first) + generate
    providers/          # presets, OpenAI-compatible + Anthropic adapters
    provider-store.ts   # lkv-providers.json + per-provider key files
    plugin-loader.ts    # declarative plugin.json packs (no code execution)
    import-url.ts       # Add from URL (fetch → extract text → auto-tag → note)
    import-markdown.ts  # Import Markdown/Obsidian notes from a folder
    book-import.ts      # Import book / PDF (EPUB chapters, PDF page groups)
    personality-pack.ts # personality export/import files
    test-to-notes*.ts   # Test to notes: parse results, draft corrective notes
    review.ts / study.ts # spaced review schedule, Study mode attempts + calibration
    media-*.ts          # Media chat ingest (captions → timed notes), voices (code says "personas")
    mcp-client.ts       # in-app MCP client (Streamable HTTP + OAuth)
    bridge-server.ts    # loopback HTTP bridge on 127.0.0.1:8765 (LKV_BRIDGE_PORT)
    citation-pack.ts    # export an Ask session as an evidence bundle
    secret-store.ts     # safeStorage encryption for keys and tokens (plaintext fallback)
    secret-files.ts     # where secrets live; encrypts old plaintext ones at startup
    update-check.ts     # launch-time GitHub release check (can be turned off)
    user-data.ts        # userData resolution (LKV_USER_DATA_DIR override)
  src/                  # React UI; built-in panels in src/plugins/
  tests/renderer/       # Vitest + jsdom tests for the React UI
  bridges/              # Obsidian plugin scaffold, Notion notes / CLI stub
  examples/plugins/     # sample plugin.json packs
  scripts/              # headless smoke tests for the main process
  build/                # app icons (icon.png 1024×1024, icon.ico)
```

The database lives at `app.getPath('userData')/lkv.sqlite`. Items are stored in `items`, with an
`items_fts` FTS5 table kept in sync by triggers. Search turns the query into an OR of prefix
terms and ranks with BM25. There are no embeddings.

## Install

```bash
git clone https://github.com/tosin2013/local-knowledge-vault.git
cd local-knowledge-vault
npm install
```

`better-sqlite3` is a native module. `postinstall` runs `electron-builder install-app-deps` to
rebuild it for Electron's ABI. On some Linux machines you need build tools (`python3`, `make`,
`g++`).

## Run

```bash
npm run dev
```

This opens Electron with Vite HMR. If the machine has no display, use the headless checks below.

### Test a fresh install (default state)

Vault keeps its notes, settings and keys in a per-machine user-data folder (see the
[environment table](#environment-overrides) below). Because a lot of onboarding work runs once per
install — the seeded "Vault guide" project, the `sample_notes_seeded` flag, versioned migrations —
re-running `npm run dev` against your normal profile reuses that state, so first-run changes may not
show up.

To see a clean first-run experience, point the app at an empty folder:

```bash
LKV_USER_DATA_DIR=/tmp/vault-fresh npm run dev
```

Any empty directory works. A shell alias makes this quick:

```bash
alias vault-fresh='LKV_USER_DATA_DIR="$(mktemp -d /tmp/vault-fresh.XXXXXX)" npm run dev'
```

Make sure you are on the branch with the change — `main` does not contain unmerged feature branches.

## Checks (headless)

There are two test suites. The main-process suite is a set of smoke scripts in `scripts/` that run
under Electron-as-Node (`ELECTRON_RUN_AS_NODE=1 electron -r tsx/cjs scripts/<file>.ts`) so
`better-sqlite3` matches Electron's ABI; each exits non-zero on failure. The renderer suite uses
Vitest, jsdom and Testing Library in `tests/renderer/`, with `window.lkv` mocked in
`tests/renderer/lkv.ts` (see [ADR 0001](./adr/0001-renderer-test-harness.md)).

| Script | What it does |
|---|---|
| `npm run typecheck` | `tsc` for the Electron and renderer projects, and the renderer tests (`tsconfig.tests.json`) |
| `npm run build` | typecheck + Vite build of renderer and main |
| `npm run test:ci` | every offline main-process suite below, in sequence (what CI runs) |
| `npm run test:renderer` | the renderer suite (`vitest run`) |
| `npm run coverage` | `test:ci` under c8, then the renderer suite with coverage, merged into `coverage/lcov.info` |
| `npm run coverage:main` | `test:ci` under c8 with the 80% line gate for `electron/` |

Main-process suites in `test:ci`:

| Script | What it does |
|---|---|
| `test:mvp` | DB seed, filters, FTS hits, citation-hallucination rejection, `ollama.health()` survives Ollama being down |
| `test:providers` | provider registry, adapters (mock servers), settings migration and plugin loader |
| `test:provider-errors` | adapter error paths (HTTP errors, timeouts, bad JSON, missing keys) |
| `test:grounding-routing` | grounded Ask and chat routing, citation clean-up, personality fencing |
| `test:notes-vs-transcripts` | your notes rank before transcript chunks in Ask; Media chat stays transcript-first |
| `test:citation-pack` | citation pack export |
| `test:media` | SRT caption parsing and chunking into timed notes |
| `test:media-ingest` | media ingest paths and `yt-dlp` discovery |
| `test:media-personas` | Media voices: definitions, seeding, Add voice, profiles |
| `test:mcp` | MCP client against a local mock Streamable HTTP + OAuth server |
| `test:bridge` | Vault Bridge auth, routes, token storage and port-in-use handling |
| `test:ipc-preload` | IPC handlers and the preload surface with Electron stubbed |
| `test:url-import` | Add from URL against a local fixture server |
| `test:markdown-import` | Markdown / Obsidian folder import |
| `test:books` | EPUB and PDF import, including Gutenberg clean-up |
| `test:personalities` | personality export/import files |
| `test:test-to-notes` | Test to notes parsing and grounded corrective notes |
| `test:review` | spaced review scheduling |
| `test:study` | Study mode attempts and calibration |
| `test:secret-store` | key and token encryption, and the startup encryption of plaintext secrets |
| `test:store-loader` | user-data and store/loader edge cases |
| `test:update-check` | update notice: version compare, stubbed GitHub check, setting |

Not in `test:ci` (they use the network): `test:providers:live` (live Groq "Test connection" with your
saved key; read-only, never prints the key) and `test:mcp-discovery` (Notion MCP discovery).

## Environment overrides

| Variable | Default / effect |
|---|---|
| `LKV_OLLAMA_URL` | `http://127.0.0.1:11434` |
| `LKV_LMSTUDIO_URL` | `http://127.0.0.1:1234/v1` |
| `LKV_OLLAMA_MODEL` | force a model name. Otherwise Vault skips embedding models, prefers 3B+ params, and prefers qwen3 → llama3.2 → llama3 → gemma3 → mistral |
| `LKV_YTDLP_PATH` | explicit `yt-dlp` binary for Media chat. Otherwise Vault checks `PATH`, `<userData>/bin/`, Homebrew, `~/.local/bin` (pipx/uv), Scoop/winget, then a repo `.venv-ytdlp` |
| `LKV_YTDLP_EXTRA_ARGS` | extra `yt-dlp` arguments for YouTube caption downloads, whitespace-separated (for example `--cookies-from-browser firefox` when YouTube rate-limits with HTTP 429) |
| `LKV_USER_DATA_DIR` | use a different settings / keys / plugins / database folder (for example a throwaway demo profile) |
| `LKV_BRIDGE_PORT` | Vault Bridge port (1024–65535, default `8765`). Use it to run a second profile's bridge alongside the first |
| `LKV_<PRESET>_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, … | provider keys; env vars win over saved key files (see [providers.md](./providers.md)) |

## IPC API (`window.lkv`)

- `items.list({ filters? })`
- `items.create({ title, body, para, kind, status, project, summary? })`
- `items.get(id)` / `items.update(id, patch)` / `items.delete(id)`
- `search.query({ text, filters, limit? })`
- `ask.grounded({ question, filters, limit? })`
- `import.fromUrl(url)` / `import.fromMarkdown()` (folder picker → bulk `.md` import)
- `ollama.health()`
- `llm.status()`: active provider, provider list with health, first-run flag
- `providers.list / setSelected / setEnabled / save / remove / test / fetchModels` (keys are write-only)
- `plugins.list / install / setEnabled / remove / reload / openFolder / contributions`

Chat sessions, profiles, prompts, Media chat, MCP and citation-pack calls are also exposed; see
`electron/preload.ts` for the full surface.

## Grounding contract

- Ask retrieves matching notes (keyword search), then sends the model the numbered passages
  (up to ~1,200 characters of each note) and fixed rules: answer only from the passages, cite
  `[itm_…]`, say so when the passages don't cover the question.
- Citations in the answer are checked against the retrieved ids. Unknown ids are dropped.
- If search finds nothing, Vault answers "I couldn't find that in your notes" without calling a
  model.
- Personalities and voices change style only. A personality is fenced in the system prompt as
  tone-and-format guidance, and the grounding rules are restated after it so they come last
  (`composeGroundedSystem` in `electron/generate.ts`).

## Packaging

Installers for macOS (dmg/zip), Linux (AppImage/deb/rpm/snap) and Windows (NSIS) are built with
electron-builder:

```bash
npm run dist:linux   # on Linux
npm run dist:mac     # on macOS
npm run dist:win     # on Windows
npm run dist         # current platform
```

`better-sqlite3` is native, so package on the target OS rather than cross-compiling. The
GitHub Actions workflows (CI and release) are described in [release.md](./release.md).
