# Friendly UI pass — result

Date: 2026-09-23 (America/New_York)

## Goal

Same brain (IPC, DB, chat, prompts, search), softer face. **Simple is default**; **Advanced** unlocks developer knobs.

## Files changed

- `src/App.tsx` — labels, defaults, Advanced toggle, filters, empty copy, IDs gated
- `src/styles.css` — chips, AI warn status, larger primary controls, composer prominence, mode toggle
- `FRIENDLY_UI_RESULT.md` — this summary

No electron/DB/schema/IPC changes. Preference: `localStorage` key `lkv.uiMode` = `simple` | `advanced`.

## What changed (by requirement)

### 1. Primary surfaces
- Tabs: **Notes** | **Find** | **Ask** | **Answer styles** (modes still `editor` / `search` / `chat` / `prompts`)
- Brand: **Knowledge Vault**
- Top search placeholder: “Search your notes…”
- Buttons: **Find** (runs FTS search → Find tab), **Ask AI** (jumps to Ask / chat, prefills composer from search text)

### 2. Softer AI status
- Ready: green **AI: ready**
- Down: amber **AI: not available — search still works**
- Hover title: “Uses Ollama on this computer”
- Health poll unchanged (`ollama.health` every 15s)

### 3. Ask-first home
- Initial `mode` is **`chat` (Ask)**, not Editor
- Empty Notes: friendly “Pick a note… / Your notes stay on this computer.”

### 4. Sidebar filters
- **+ New note** unchanged
- Simple PARA chips: All / Projects / Areas / Resources / Archive
- Kind / status / project behind **Filters** disclosure (closed by default) in simple mode; always visible in Advanced (plus PARA dropdown)
- List badges use plain PARA words (Projects, Areas, …)

### 5. Hide technical IDs
- Note footer: no `itm_…` in simple mode
- Advanced: shows id + **Copy id**
- Chat citation chips remain title-based

### 6. Advanced toggle
- Header checkbox **Advanced**; persists `lkv.uiMode`
- Unlocks: fuller filters, item ids, search scores, prompt body editor front-and-center
- Tab names stay friendly in both modes

### 7. Empty states & copy
- Ask: “Ask anything about your notes. Example: What did I write about habits?”
- Find: “Search to find notes, or ask a question with Ask AI.”
- Answer styles: “Pick how Ask should answer…”
- “Mode: grounded” → **Answers from your notes** (Advanced hints “Coming soon: brainstorm”)
- Composer label: **Answer style** (was Prompt)

### 8. Visual polish
- `.btn-lg` larger hit targets on primary actions
- Ask composer `.prominent` (slightly larger textarea, shadow)
- Dark theme retained; light hierarchy only

### Answer styles (simple vs advanced)
- Simple: list by name/description; **Edit** reveals body; **Use in Ask** available
- Advanced: full body editor as before (auto-opens when Advanced is on)

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` | clean |
| `npm run test:mvp` | **51 passed, 0 failed** |

## How to try

```bash
cd /workspace/local-knowledge-vault
npm run dev
```

1. App should open on **Ask** with soft empty copy.
2. Confirm tabs read Notes / Find / Ask / Answer styles.
3. AI status should say ready or “not available — search still works” (not “Ollama: offline”).
4. Sidebar: PARA chips; open **Filters** for type/status/project.
5. Toggle **Advanced**: note ids, fuller filters, search scores appear; preference survives reload.
6. Create/open a note — no bare `itm_` in simple footer.
7. Chat send + Answer styles pick still work as before.

## Out of scope (unchanged)

Brainstorm, HNSW/RRF/plugins, git commit, citation validation, DB schema.
