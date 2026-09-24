# Local Knowledge Vault (MVP)

Local-first Electron desktop app for PARA-organized notes with **SQLite FTS5** full-text search and optional **Ollama** grounded Q&A that only cites retrieved item IDs.

Search works with **no network and no Ollama**. Ask requires a local Ollama instance.

## What this MVP includes

- Notes stored in SQLite (`items` + `items_fts` FTS5, BM25 ranking)
- PARA / kind / status / project metadata + filters applied with search
- Create / list / edit / delete notes
- Search UI + Ask UI with citation chips that open the cited note
- Grounded Ask: retrieve → prompt Ollama → **drop hallucinated citation IDs**
- Seed sample notes on first launch so search works immediately

## Out of scope (intentionally)

Vectors/HNSW, RRF fusion, link expand, plugins, PDF import, brainstorm sessions, cloud LLM providers (only a stub comment in code).

## Layout

```
local-knowledge-vault/
  electron/
    main.ts        # Electron lifecycle + IPC
    preload.ts     # contextBridge `window.lkv`
    db.ts          # schema, triggers, CRUD, seed
    search.ts      # filters + FTS5
    ollama.ts      # localhost:11434 client
    generate.ts    # grounded ask + citation validation
    types.ts
  src/             # React UI (Vite)
  scripts/test-mvp.ts
  package.json
  vite.config.ts
```

DB path: Electron `app.getPath('userData')/lkv.sqlite`.

## Install

```bash
cd local-knowledge-vault
npm install
```

`better-sqlite3` is a native module; Electron rebuild runs via `postinstall` (`electron-builder install-app-deps`). On some Linux boxes you may need build tools (`python3`, `make`, `g++`).

## Run

```bash
npm run dev
```

Opens Electron + Vite HMR. If this environment has no display / Electron GUI fails, use the headless checks below — the app is still meant to be run on your machine.

### Headless / CI verification (no GUI)

```bash
npm run test:mvp
npm run typecheck
```

`test:mvp` runs via `ELECTRON_RUN_AS_NODE` so `better-sqlite3` matches Electron's ABI. It validates: DB seed, filters, FTS5 hits, citation hallucination rejection, and that `ollama.health()` does not crash when Ollama is down.

## Ollama (optional for Search, required for Ask)

1. Install and run [Ollama](https://ollama.com)
2. Pull a model, e.g. `ollama pull llama3.2`
3. App probes `http://127.0.0.1:11434/api/tags`

Env overrides:

- `LKV_OLLAMA_URL` — default `http://127.0.0.1:11434`
- `LKV_OLLAMA_MODEL` — force a model name; otherwise prefers `llama3.2*`, then any llama, then first listed model

If Ollama is down, Search still works; Ask returns hits + `offline: true`.

## IPC API (`window.lkv`)

- `items.list({ filters? })`
- `items.create({ title, body, para, kind, status, project, summary? })`
- `items.get(id)` / `items.update(id, patch)` / `items.delete(id)`
- `search.query({ text, filters, limit? })`
- `ask.grounded({ question, filters, limit? })`
- `ollama.health()`

## Success criteria checklist

- [x] `npm install` works
- [x] `npm run test:mvp` — DB creates, FTS returns seeded notes, citation validator rejects hallucinated IDs, ollama health does not crash when down
- [x] `npm run typecheck` (or documented if Electron GUI cannot open headless)
- [x] Search works without Ollama
- [x] Ask cites only retrieved IDs
- [x] UI: create/list/filter/search/ask + citation open

## Packaging & release

Installers for **macOS** (dmg/zip), **Linux** (AppImage/deb), and **Windows** (NSIS) are built with [electron-builder](https://www.electron.build/).

```bash
npm run dist:linux   # current machine must be Linux
npm run dist:mac     # macOS
npm run dist:win     # Windows
```

`better-sqlite3` is native — electron-builder rebuilds it per platform. Prefer the GitHub Actions matrix (`.github/workflows/release.yml`) rather than cross-compiling.

Cut a tagged release:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

See [docs/release.md](docs/release.md) for artifacts and CI details. App icon source: `build/icon.png`.

## License

Private MVP — local use.
