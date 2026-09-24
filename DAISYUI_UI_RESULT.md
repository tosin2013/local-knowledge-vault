# daisyUI UI restyle — result

Date: 2026-09-23 (America/New_York)

## Goal

Restyle Local Knowledge Vault with **Tailwind CSS 4 + daisyUI 5**, inspired by the daisyUI store: **light airy workspace**, violet/blue primary CTAs, soft cards, soft/outline badges — while keeping Friendly UI behavior unchanged.

## Theme chosen

| Choice | Value |
|--------|--------|
| Theme | **`light`** (`data-theme="light"`) |
| Mood | White/base-100 surfaces, charcoal text, thin gray dividers, soft shadows |
| Primary | Violet-blue (`oklch(52% 0.25 277)`) via `@plugin "daisyui/theme"` |
| Radii | Pill selectors (`999px`), moderate fields/boxes (`0.5rem` / `0.75rem`) |
| Electron window | `backgroundColor: '#ffffff'` |

Dark themes (`night` / `business`) were rejected after store inspection — the store look is light and airy, not a heavy dark dashboard.

## Packages added

```json
"devDependencies": {
  "tailwindcss": "^4.3.3",
  "@tailwindcss/vite": "^4.3.3",
  "daisyui": "^5.7.44"
}
```

Vite config renamed to **`vite.config.mts`** so `@tailwindcss/vite` (ESM-only) loads cleanly under Vite 5.

## Files changed

| File | Change |
|------|--------|
| `package.json` / lockfile | Tailwind 4 + daisyUI 5 |
| `vite.config.mts` | `@tailwindcss/vite` plugin (was `.ts`) |
| `src/styles.css` | `@import "tailwindcss"` + daisyUI light theme + minimal Electron shell grid CSS |
| `src/App.tsx` | daisyUI component classes; Friendly UX kept |
| `src/main.tsx` | unchanged (still imports `./styles.css`) |
| `index.html` | `data-theme="light"` |
| `electron/main.ts` | window `backgroundColor: '#ffffff'` |
| `DAISYUI_UI_RESULT.md` | this summary |

No Electron IPC / DB / schema / test logic changes.

## Key class patterns

| Area | Classes |
|------|---------|
| Shell | `navbar` + `navbar-start` / `navbar-center` / `navbar-end` |
| Search row | `join` + `input input-bordered` + `btn` / `btn-primary` (`Ask AI`) |
| AI status | `badge badge-soft` + `badge-success` / `badge-warning` |
| Advanced | `toggle toggle-sm toggle-primary` + `localStorage` `lkv.uiMode` |
| Sidebar | `bg-base-100`, thin `border-base-300`, PARA `btn btn-xs` pills |
| Note tags | `badge badge-soft badge-primary`, `badge-outline` |
| Tabs | `tabs tabs-boxed` + `tab` / `tab-active` — Notes \| Find \| Ask \| Answer styles |
| Surfaces | `card` / `card-body` / `card-title`, soft `shadow-sm` + `border-base-200` |
| Forms | `input` / `textarea` / `select` (`*-bordered`, `*-sm`/`*-xs`) |
| Ask thread | `chat chat-start` / `chat-end` + `chat-bubble` / `chat-bubble-primary` |
| Errors / offline | `alert alert-error` / `alert-warning` |
| Actions | `btn-primary`, `btn-ghost`, `btn-error btn-outline`, `btn-link` |

Minimal custom CSS remains only for Electron height/overflow grids (`.app`, `.main`, `.chat-layout`, etc.).

## Friendly UI preserved

- Tabs: **Notes | Find | Ask | Answer styles**
- Ask-first default (`mode === 'chat'`)
- Soft AI status copy (“AI: ready” / “not available — search still works”)
- PARA chips + **Filters** disclosure
- **Advanced** toggle + `lkv.uiMode`
- Hide note ids in simple mode

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` | clean |
| `npm run test:mvp` | **51 passed, 0 failed** |
| `npx vite build` | clean (daisyUI 5 CSS emitted) |

## How to try

```bash
cd /workspace/local-knowledge-vault
npm run dev
```

1. App should open on **Ask** with a **white/light** workspace and violet primary buttons.
2. Top bar: brand · search `join` (Find + **Ask AI**) · soft AI badge · Advanced toggle.
3. Sidebar: PARA pills; Filters disclosure in simple mode.
4. Ask messages use daisyUI **chat bubbles**.
5. Toggle Advanced — ids / fuller filters / scores still appear; preference survives reload.

## Screenshots guidance

Capture with `npm run dev` (Electron window):

1. **Ask empty** — light shell, prominent composer, soft empty card.
2. **Notes list + editor** — soft selected row (`bg-primary/5`), soft PARA badges.
3. **Find results** — `card` hit list with soft borders.
4. **Advanced on** — note id + Copy id visible; compare to simple mode.


## Blank window fix (post-restyle hygiene)

**Cause:** Two overlapping `npm run dev` sessions left Vite on **5173** and **5174**; Electron could attach to a stale server / race, showing a blank white window. Restrictive CSP also lacked `connect-src` for Vite HMR (`ws:` / localhost).

**Changes (minimal, UI left running):**
1. Killed the stale **5173** Vite + Electron pair; left the healthy **5174** Vite + Electron alone (UI already rendering Ask/Notes with light daisyUI).
2. Loosened `index.html` CSP for Electron+Vite: `script-src` adds `'unsafe-inline' 'unsafe-eval'`; `connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:*` (styles/img unchanged). `data-theme="light"` kept.
3. Confirmed only `vite.config.mts` (no conflicting `vite.config.ts`).

**Verify:** `npm run typecheck` clean; `npm run test:mvp` **51/51**. Dev left running: one Vite (5174) + one Electron.

## Out of scope (unchanged)

Brainstorm feature, git commit, schema changes, paid daisyUI store templates (inspiration only).
