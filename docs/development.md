# Developing Vault

Notes for people building or hacking on Vault (Local Knowledge Vault). The user-facing overview
is in the [README](../README.md).

## Stack

- **Electron 33** main process (`electron/`): SQLite via `better-sqlite3`, IPC, provider registry,
  plugin loader, MCP client, local HTTP bridge.
- **React 18 + Vite 5 + TypeScript** renderer (`src/`), MUI components.
- **electron-builder** for installers.

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
    media-*.ts          # Media chat ingest (captions → timed notes), personas
    mcp-client.ts       # in-app MCP client (Streamable HTTP + OAuth)
    bridge-server.ts    # loopback HTTP bridge on 127.0.0.1:8765
    citation-pack.ts    # export an Ask session as an evidence bundle
    user-data.ts        # userData resolution (LKV_USER_DATA_DIR override)
  src/                  # React UI; built-in panels in src/plugins/
  bridges/              # Obsidian plugin scaffold, Notion notes / CLI stub
  examples/plugins/     # sample plugin.json packs
  scripts/              # headless smoke tests
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

## Checks (headless)

| Script | What it does |
|---|---|
| `npm run typecheck` | `tsc` for the Electron and renderer projects |
| `npm run build` | typecheck + Vite build of renderer and main |
| `npm run test:mvp` | DB seed, filters, FTS hits, citation-hallucination rejection, `ollama.health()` survives Ollama being down |
| `npm run test:providers` | offline tests of the provider registry, adapters (mock servers), settings migration and plugin loader |
| `npm run test:providers:live` | live Groq "Test connection" with your saved key (read-only; never prints the key) |
| `npm run test:citation-pack` | citation pack export |
| `npm run test:media` | SRT caption parsing and chunking into timed notes (plus an optional temp-DB ingest) |
| `npm run test:mcp-discovery` | Notion MCP discovery smoke test (uses the network) |

The `test:*` scripts that touch SQLite run under `ELECTRON_RUN_AS_NODE=1` so `better-sqlite3`
matches Electron's ABI.

## Environment overrides

| Variable | Default / effect |
|---|---|
| `LKV_OLLAMA_URL` | `http://127.0.0.1:11434` |
| `LKV_LMSTUDIO_URL` | `http://127.0.0.1:1234/v1` |
| `LKV_OLLAMA_MODEL` | force a model name. Otherwise Vault skips embedding models, prefers 3B+ params, and prefers qwen3 → llama3.2 → llama3 → gemma3 → mistral |
| `LKV_USER_DATA_DIR` | use a different settings / keys / plugins / database folder (for example a throwaway demo profile) |
| `LKV_<PRESET>_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, … | provider keys; env vars win over saved key files (see [providers.md](./providers.md)) |

## IPC API (`window.lkv`)

- `items.list({ filters? })`
- `items.create({ title, body, para, kind, status, project, summary? })`
- `items.get(id)` / `items.update(id, patch)` / `items.delete(id)`
- `search.query({ text, filters, limit? })`
- `ask.grounded({ question, filters, limit? })`
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
- Personas and personalities change style only; they are wrapped in the same rules.

## Packaging

Installers for macOS (dmg/zip), Linux (AppImage/deb) and Windows (NSIS) are built with
electron-builder:

```bash
npm run dist:linux   # on Linux
npm run dist:mac     # on macOS
npm run dist:win     # on Windows
npm run dist         # current platform
```

`better-sqlite3` is native, so package on the target OS rather than cross-compiling. The
GitHub Actions workflows (CI and release) are described in [release.md](./release.md).
