# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Vault (Local Knowledge Vault): an Electron desktop app for chatting with personal notes, where every answer cites
the note it came from (`[itm_…]`) or says it doesn't know. Notes live in local SQLite. Answers come from a local
model first (Ollama / LM Studio), with optional cloud providers. User-facing docs are in `README.md`, developer
docs in `docs/development.md`, providers in `docs/providers.md`, plugin format in `docs/plugins-authoring.md`.

## Commands

```bash
npm install            # postinstall rebuilds better-sqlite3 for Electron's ABI
npm run dev            # Electron + Vite HMR (renderer on :5173)
npm run typecheck      # tsc for both projects: tsconfig.node.json (electron/, scripts/) and tsconfig.json (src/)
npm run build          # typecheck + vite build → dist/ and dist-electron/
npm run dist:mac       # installers via electron-builder (also dist:win, dist:linux); package on the target OS
```

There is no test framework. Tests are standalone headless smoke scripts in `scripts/` with a local `assert`
helper that exit non-zero on failure. Run one with its npm script:

```bash
npm run test:mvp            # DB, FTS search, citation validation, prompts/chat, ollama health when Ollama is down
npm run test:providers      # provider registry, adapters vs mock servers, settings migration, plugin loader (offline)
npm run test:media          # SRT/VTT caption parsing and chunking
npm run test:citation-pack  # citation pack export
npm run coverage            # every test:* suite in test:ci under c8 → coverage/lcov.info (CI uploads to Codecov)
npm run coverage:main       # same main-process run, failing below 80% electron/ lines (the #83 gate)
npm run test:providers:live # live Groq call with saved key (network)
npm run test:mcp-discovery  # Notion MCP discovery (network)
```

Any script that touches SQLite must run under Electron-as-Node so `better-sqlite3` matches the ABI:
`ELECTRON_RUN_AS_NODE=1 npx electron -r tsx/cjs scripts/<file>.ts`. Plain `tsx` fails with a native-module
version mismatch. Tests create their own temp dirs (`fs.mkdtempSync`); set `LKV_USER_DATA_DIR` to point the app
at a throwaway profile.

## Architecture

**Two processes, one typed IPC surface.**
- `electron/` is the main process: all data, network and LLM work. `electron/main.ts` registers
  `ipcMain.handle('<area>:<action>', …)` handlers that delegate to modules.
- `electron/preload.ts` exposes the `api` object as `window.lkv` via `contextBridge` and exports its type `LkvApi`.
  `src/vite-env.d.ts` imports that type, so the renderer is typed against the preload directly.
- Shared request/response types live in `electron/types.ts`.
- Adding an IPC call means touching three places: the handler in `main.ts`, the method in `preload.ts`, and any
  types in `types.ts`.
- `src/` is the React 18 renderer, styled with MUI using a Material 3 theme (`src/theme/m3Theme.ts`). `src/App.tsx`
  is a large single component holding most of the UI (Ask home, notes rail, note peek, Simple/Advanced modes).

**Data and retrieval.** `electron/db.ts` owns the schema, migrations, CRUD and first-launch seed notes. Notes go in
`items`, and an `items_fts` FTS5 table is kept in sync by triggers. `electron/search.ts` turns a query into an OR of
prefix terms, ranks with BM25 and applies PARA/kind/status/project filters. There are no embeddings.

**Grounding contract** (`electron/generate.ts`, `electron/chat.ts`). Every answer path must keep these rules:
- Retrieve notes, then send the model numbered passages (about 1,200 chars each) with fixed rules.
- Extract `[itm_…]` citations from the answer and drop any id that wasn't retrieved (`validateCitations`).
- If search finds nothing, return "I couldn't find that in your notes" without calling a model.
- Personas and personalities (`media-personas.ts`, chat profiles) only change style. They are wrapped inside the
  same rules and never replace them.

**LLM routing** (`electron/llm.ts`). Every generation path goes through `llmGenerate`: Ask, Chat, Media chat,
personas, URL auto-tag and the HTTP bridge.
- Auto mode tries, in order: Ollama, LM Studio, other enabled local URLs, then enabled cloud providers that have
  a key.
- An explicit selection uses only that provider, with no silent fallback.
- Adapters live in `electron/providers/`: `openai-compatible.ts` covers most presets, `anthropic.ts` is separate,
  and `presets.ts` defines the preset table and the recommended local model.
- `provider-store.ts` persists `lkv-providers.json` and keeps per-provider keys in owner-only files under
  `lkv-keys/`. Env vars (`LKV_<PRESET>_API_KEY`, `OPENAI_API_KEY`, …) take precedence over key files.
- Keys are write-only from the renderer and must never be returned over IPC.

**Two plugin systems. Don't mix them up.**
- *Declarative packs* (`electron/plugin-loader.ts`): `plugin.json` folders or zips in `<userData>/plugins/` that
  contribute provider presets, personas, prompt packs and MCP server presets. They never execute code and cannot
  ship API keys or custom headers. The loader validates packs and reports why a pack was rejected. Examples are in
  `examples/plugins/`.
- *Built-in panels* (`src/plugins/`): React views compiled into the app. To add one, export a `VaultPlugin` from
  `src/plugins/<id>/index.ts` and append it to `plugins` in `src/plugins/registry.ts`. The header Plugins menu
  picks it up automatically. `src/plugins/contrib.tsx` surfaces declarative-pack contributions in the UI.

**Other main-process subsystems.**
- `media-ingest.ts` / `media-captions.ts`: YouTube captions via an external `yt-dlp`, or local media plus
  `.srt`/`.vtt`, turned into timed transcript notes.
- `mcp-client.ts`: Streamable HTTP MCP client with OAuth (Notion preset). It is not yet used inside Ask.
- `bridge-server.ts`: a bearer-token-authenticated loopback HTTP API on `127.0.0.1:8765`
  (`/health`, `/v1/projects`, `/v1/ask`) used by the Obsidian plugin in `bridges/obsidian-vault/`.
  Token is generated at `<userData>/lkv-bridge-token` (0600); `/v1/*` require `Authorization:
  Bearer <token>` and JSON bodies are size-capped.
- `citation-pack.ts`: exports an Ask session with its cited notes and a manifest.
- `import-url.ts`: fetches a page, extracts text and auto-tags it into a note.
- `user-data.ts`: resolves userData, honoring the `LKV_USER_DATA_DIR` override.

## Gotchas

- `better-sqlite3` and `electron` are Rollup externals in `vite.config.mts`. Keep new native modules external too.
- The `*_RESULT.md` files at the repo root (BLINK, DAISYUI, FRIENDLY, CHAT_PROMPTS) are historical notes from UI
  experiments. They mention Tailwind/daisyUI themes, but the current UI is MUI; see `src/styles.css`.
- `scripts/*.bundle.cjs` are prebuilt bundles of the matching `.ts` scripts, so edit the `.ts` source.
- The GitHub Actions release workflow described in `docs/release.md` is not committed yet.
