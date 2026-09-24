# Local Knowledge Vault (MVP)

Local-first Electron desktop app for PARA-organized notes with **SQLite FTS5** full-text search and grounded Q&A that only cites retrieved item IDs.

Search works with **no network and no model**. Ask uses a **local model first**: Ollama or LM Studio, auto-detected. You can add your own cloud provider too (OpenAI, Anthropic, Gemini, OpenRouter, Mistral, DeepSeek, Together, Groq, xAI or any OpenAI-compatible URL). See **[docs/providers.md](./docs/providers.md)**. Shareable, code-free plugins are covered in **[docs/plugins-authoring.md](./docs/plugins-authoring.md)**.

## What this MVP includes

- Notes stored in SQLite (`items` + `items_fts` FTS5, BM25 ranking)
- PARA / kind / status / project metadata + filters applied with search
- Create / list / edit / delete notes
- Search UI + Ask UI with citation chips that open the cited note
- Grounded Ask: retrieve → prompt Ollama → **drop hallucinated citation IDs**
- Seed sample notes on first launch so search works immediately

## Out of scope (intentionally)

Vectors/HNSW, RRF fusion, link expand, PDF import, brainstorm sessions, streaming responses.

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

## Local models (recommended) and other providers

1. Install and run [Ollama](https://ollama.com) (or [LM Studio](https://lmstudio.ai) with a model loaded).
2. Pull a small model that follows instructions well: `ollama pull qwen3:8b` (alternative: `llama3.1:8b`).
3. Vault detects it automatically. The header chip reads `Local · Ollama · qwen3:8b`.

Env overrides:

- `LKV_OLLAMA_URL`: default `http://127.0.0.1:11434`
- `LKV_LMSTUDIO_URL`: default `http://127.0.0.1:1234/v1`
- `LKV_OLLAMA_MODEL`: forces a model name. Otherwise Vault prefers non-embedding models of 3B+ params (qwen3 → llama3.2 → llama3 → …).
- `LKV_USER_DATA_DIR`: use a different settings/keys/plugins folder (for example a throwaway profile).

With no model available, Search still works and Ask returns the matching notes plus a friendly notice. Cloud providers, key storage and the migration from the old Groq/Grok settings are described in [docs/providers.md](./docs/providers.md).

Extra checks:

- `npm run test:providers` runs offline tests of the registry, adapters (mock servers), migration and plugin loader.
- `npm run test:providers:live` runs a live Groq "Test connection" using your saved key. It is read-only and never prints the key.

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
