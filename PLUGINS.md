# Vault plugins

There are two kinds of plugins:

1. **Declarative plugins (`plugin.json`)**: shareable packs of provider presets, voices and
   personalities (the `personas` key), prompt packs and MCP server presets. They run no code. You
   install them from **Plugins → Add-ons…** (folder or .zip) or drop them into `<userData>/plugins/`. See
   **[docs/plugins-authoring.md](./docs/plugins-authoring.md)** and `examples/plugins/`.
2. **Built-in panels**: React views compiled into the app (below). They can be hidden in
   **Add-ons…**.

Study, Review and Test to notes used to be built-in panels. They now live in the top-level
**Study** tab (see [Study tab (not an add-on)](#study-tab-not-an-add-on)).

## Built-in panels

Built-in panels are optional full-panel views registered in a lightweight in-app registry. They do **not** replace Ask-home for notes: opening a plugin switches the center panel; the notes rail and note peek stay available.

## How to add a plugin

1. Create a folder under `src/plugins/<your-id>/` with a React view component.
2. Export a `VaultPlugin` descriptor (`id`, `name`, `description`, `render`).
3. Register it in `src/plugins/registry.ts` by appending to the `plugins` array.
4. The header **Plugins** menu lists every registered plugin automatically (minus ones hidden in **Add-ons…**). No menu edits are needed.

Example:

```ts
// src/plugins/registry.ts
import { myPlugin } from './my-plugin'
export const plugins: VaultPlugin[] = [mediaChatPlugin, mediaPersonasPlugin, mcpConnectionsPlugin, myPlugin]
```

Backend work (IPC, ingest, DB) lives under `electron/` and is exposed via `preload.ts` → `window.lkv.*`, same as core features.

## Media chat (first plugin)

- **Id:** `media-chat`
- **Ingest:** local video/audio + companion `.srt`/`.vtt`, or YouTube URL via `yt-dlp`
- **Notes:** caption chunks → `kind: transcript` notes with `t_start` / `t_end` / source metadata
- **Profile:** auto-creates **Media reader** personality + a project-bound chat profile
- **UI:** player + grounded Ask; Follow playhead; citation click seeks the player (local media and YouTube embeds); fullscreen Dialog for player + Ask (ingest collapsed; transcript notes stay in vault)
- **Voice chips:** when a project is active, switch among **Media reader** and installed Media voices without leaving the panel — **only** updates `active.promptId` / session prompt (does **not** create per-video profiles). Last voice name is remembered in `localStorage` (`lkv.mediaVoice`) and restored when opening any media project. `filters.project` stays the open media for retrieval.

## Media voices

- **Id:** `media-personas` (the code keeps the older "persona" name; the UI says **voice**)
- **What:** reusable grounded “voice pack” personalities for Media chat — built-ins **Desk cohost**, **Curious student**, **Skeptical investor**, plus **Easy Add** custom voices. **Not tied to each video** — one install works with any ingested media.
- **Rules first:** each prompt body starts with the hard Media rules (answer only from provided transcript notes, cite `[itm_…]`, mention times when useful, say you don’t know when unsupported). Style never overrides grounding. Shared helper: `buildMediaVoicePromptBody` in `electron/media-persona-defs.ts`.
- **Easy Add:** panel **Add voice** form (name + speaking style required) → `media:createPersona` upserts a Personality tagged `Media voice pack:` (plus a small JSON registry in userData). Custom packs appear in the panel and in Media chat voice chips via `media:listVoicePacks`.
- **Primary actions:** **Install** / **Refresh prompt**, **Install / refresh all** (`media:ensurePersonas`), **Add voice** — then use **Media chat voice chips** (“Available in Media chat voice chips”).
- **Optional advanced:** `media:applyPersona` can still save an Ask profile named like `Desk cohost · <project>` — demoted in UI; default path must **not** push per-video binding.
- **How to try:** Plugins → Media voices → Install / refresh all **or** Add voice → open Media chat → switch voice chips on any project (no new voice per video).

### Interoperability note for OpenPersona

Vault supports grounded “voice pack” personas for Media chat. A Soul-like speaking style maps to the Easy Add **speaking style** field (and thus a Vault **Personality** prompt). Personas are reusable across media projects; optional project-bound **Profiles** (`applyMediaPersona`) are advanced/Ask-only, not required for Media chat. Vault does **not** run OpenPersona evolution/memory as the knowledge store — vault notes remain canonical, and personalities never invent outside those notes or override citation / I-don’t-know rules. This is what you can tell OpenPersona you support.

## Study tab (not an add-on)

Study, Review and Test to notes are no longer plugins. They live in the top-level **Study** tab
(**Ask · Find · Study**), in `src/features/study/`. Study is visible in Simple and Advanced mode and
can't be hidden in **Add-ons…**. Old panel ids (`study`, `review`, `test-to-notes`) open the matching
Study section; a saved disabled entry for them is ignored.

### Study session

- **Was:** the `review` panel (Review due notes).
- **What:** the session loop (#263): one question per card from a section of your notes, an attempt (or **I don't know**) and a confidence rating before the reveal, then the answer, a quote and a link to the note, and a Missed / Partly / Got it grade. Cards and schedules are stored in `study_cards` and `card_schedule`; attempts in `study_attempts`.
- **How to try:** Study → **Study session** → **Start session**.

### Quiz me on…

- **Was:** the `study` panel.
- **What:** recall first, then reveal the grounded, cited answer as feedback. Rate your confidence and grade yourself (**Missed**, **Partial**, **Got it**); a calibration strip compares confidence with results. Attempts are stored in the `study_attempts` table. The revealed answer uses the same renderer as chat (numbered citations, simple formatting).
- **How to try:** Study → **Quiz me on…** → ask a question → write your recall or **I don't know** → **Reveal answer**.

### Import practice test

- **Was:** the `test-to-notes` panel.
- **What:** paste or open practice-test results (numbered plain text with ✓/✗ marks, exam-site exports, answer sheets, or CSV `question,answer,correct[,correct answer,explanation]`), name and date the test, and **Add to Study** (#265): each missed question becomes a Study card seeded as Missed, built from the test's own Q&A, and linked to a covering note or to a corrective **AI draft** (cited once confirmed). **Also add the ones I got right** adds the correct ones as low-priority new cards. The test is saved as one `practice-test` item without the learner's wrong answers. **Suggest fixes** stays as an optional model step; a saved suggestion links to its card. IPC: `practiceTest:import`, `practiceTest:link`, `practiceTest:openFile`.
- **How to try:** Study → **Import practice test** → paste results → **Add to Study** → **Study session** → **Start session**.

## MCP connections

- **Id:** `mcp-connections`
- **What:** first-class in-app **MCP client**. Connect Notion’s official hosted MCP (`https://mcp.notion.com/mcp`) with OAuth (PKCE, dynamic client registration, loopback redirect), or **Add MCP server** (name + Streamable HTTP URL).
- **After connect:** status, optional workspace/user identity from the token response, and `tools/list`.
- **Primary CTA:** **Connect Notion** — seeds the Notion preset and starts OAuth in the browser.
- **Not in scope here:** wiring MCP tools into Ask chat automatically (TODO in `electron/mcp-client.ts`); local stdio MCP servers; a custom Notion community plugin.
- **How to try:** Plugins → MCP connections → Connect Notion → authorize in browser → see tools.

## Plugin endpoints (in-app · HTTP Bridge · MCP)

Vault plugins and external connectors share three endpoint classes:

1. **In-app plugins**: React panels in `src/plugins/` (this file), plus declarative `plugin.json` packs ([authoring guide](./docs/plugins-authoring.md)).
2. **Vault Bridge HTTP** — Obsidian / local tools → `127.0.0.1:8765` (see [`bridges/README.md`](./bridges/README.md), [`docs/bridges.md`](./docs/bridges.md)).
3. **MCP** — **preferred Notion path**: Vault’s in-app MCP client (Plugins → **MCP connections**). Cursor/Grok Bot Notion connectors are optional; do not rely on them alone. A custom Notion community-style plugin is **out of scope**. Scaffold notes: `bridges/notion-vault/`.

## Future plugins (sketch)

These are not built yet — they show how the same registry pattern would grow:

1. **Watch folders** — background plugin that watches a directory, auto-imports new files as vault notes (docs/PDF later), and surfaces status in its panel.
2. **Citation pack export** — thin UI wrapper around the existing citation-pack IPC so “export evidence bundle” lives as an optional plugin rather than only a chat button.
3. **Schema / ontology** — define custom kinds, required front-matter fields, and validation; notes stay normal items, plugin owns the schema catalog.
4. **Shared pattern** — each plugin owns its view + optional `window.lkv` namespace; core Ask/Find/profiles stay untouched; plugins compose retrieval by setting `filters.project` / prompts like Media chat does.

Whisper / speech-to-text for media without captions is **deferred**.
