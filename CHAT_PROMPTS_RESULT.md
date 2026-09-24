# Chat + Prompts slice — RESULT

Shipped grounded multi-turn Chat and a Prompt library into Local Knowledge Vault.

## What shipped

### Goal A — Grounded multi-turn Chat
- Schema: `chat_sessions` (`ses_…`), `chat_messages` (`msg_…`) with FK cascade
- DB helpers: list/create/get/delete sessions, list/append messages, update title
- `electron/chat.ts` `sendChatTurn`: append user → retrieve → Ollama → validate citations → append assistant
- Last ~6 user/assistant turns included in the prompt after passages + grounded rules
- Auto-title from first user message when title is still "New chat"
- Offline path still stores the user message and returns an offline-style assistant notice
- IPC + preload: `chat.listSessions|createSession|getSession|deleteSession|listMessages|send`
- UI: **Chat** tab — session list, thread with citation chips, composer (Enter send / Shift+Enter newline), sidebar filters applied, Ollama status in header

### Goal B — Prompt management
- Schema: `prompts` (`prm_…`); seeds 3 defaults when empty (Grounded default, Concise bullets, Socratic coach)
- CRUD helpers + IPC: `prompts.list|get|create|update|delete`
- UI: **Prompts** tab — list, create, edit name/body/description, delete with confirm
- Chat composer prompt dropdown; selected body is `systemExtra` merged with grounded citation rules (rules always stay)

### Goal C — Polish & tests
- Dark-theme CSS for chat bubbles, session list, prompt editor
- `buildGroundedPrompt` accepts `systemExtra` + `history`
- `npm run typecheck` clean
- `npm run test:mvp`: **51 passed, 0 failed** (prior 21 kept; added prompts CRUD, session/message CRUD, offline `sendChatTurn`, prompt extras)

## Files changed / added
| Path | Change |
|------|--------|
| `electron/types.ts` | Chat + Prompt types |
| `electron/db.ts` | Migrate tables; chat + prompt helpers; prompt seed |
| `electron/generate.ts` | `systemExtra` + history in `buildGroundedPrompt` |
| `electron/chat.ts` | **New** — multi-turn send pipeline |
| `electron/main.ts` | Chat + prompts IPC |
| `electron/preload.ts` | `window.lkv.chat` + `window.lkv.prompts` |
| `src/App.tsx` | Chat + Prompts tabs |
| `src/styles.css` | Chat/prompt styles |
| `scripts/test-mvp.ts` | New coverage |
| `CHAT_PROMPTS_RESULT.md` | This report |

## How to try it
```bash
cd /workspace/local-knowledge-vault
npm run typecheck
npm run test:mvp
npm run dev          # Electron + Vite
```
1. Open **Chat** → **+ New chat** → ask about habits / PARA / productivity (uses seeded notes).
2. Pick a prompt from the composer dropdown (or manage in **Prompts**).
3. Citation chips open the note in **Editor**.
4. Sidebar PARA/kind/status/project filters apply to retrieval on each send.

## Caveats
- **Ollama required for live answers** (`localhost:11434`). Without it, Chat still saves the user turn and shows an offline assistant notice (same idea as Ask).
- Brainstorm mode is UI stub only (“Mode: grounded”); not implemented this slice.
- No git commit was made (per request).
