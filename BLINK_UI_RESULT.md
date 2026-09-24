# Blink UI restyle — result

Date: 2026-09-23 (America/New_York)

## Goal

Restyle Local Knowledge Vault to match the **daisyUI Blink** visual language (https://blink.daisyui.com/) — dark cyan product chrome, compact density, pill CTAs — while keeping **Tailwind 4 + daisyUI 5** and all Friendly UX behavior.

## Theme

| Choice | Value |
|--------|--------|
| Default | **`blink`** (dark) via `data-theme="blink"` |
| Light toggle | **`blink-light`** |
| Persistence | `localStorage` key **`lkv.theme`** (alongside existing `lkv.uiMode`) |
| Primary | Cyan `oklch(60% .126 221.723)` |
| Secondary | Pink `oklch(65% .241 354.308)` |
| Accent | Mint `oklch(77% .152 181.912)` |
| Dark canvas | `oklch(13% .028 261.692)` → Electron `#030712` |
| Dark surface / raised | `oklch(23.26% .014 253.1)` / `oklch(21.15% .012 254.09)` |
| Font | Urbanist (Google Fonts) + system UI fallback |
| Radii | Pill selectors (`999px`), fields `0.75rem`, boxes `1rem` (16px cards) |

## Files changed

| File | Change |
|------|--------|
| `src/styles.css` | Custom `blink` + `blink-light` daisyUI themes; 240px sidebar; active-row + gradient helpers |
| `src/App.tsx` | Compact Blink chrome, theme toggle, denser lists/chat; Friendly labels kept |
| `index.html` | `data-theme="blink"`; CSP allows `fonts.googleapis.com` / `fonts.gstatic.com`; Urbanist link |
| `electron/main.ts` | `backgroundColor: '#030712'` |
| `BLINK_UI_RESULT.md` | this summary |

No IPC / DB / schema / prompt / search logic changes.

## Visual language (what changed)

- **Dark-first** navy canvas with cyan primary CTAs (replaces previous light violet store look).
- **Slim ~56px top bar** with search join, soft AI badge, Advanced toggle, **circular ~40px theme toggle** (☀/☾).
- **~240px left sidebar**; denser note rows with **cyan tint + left accent bar** when selected.
- **Pill primary buttons** (New note, Ask AI, Send, Save).
- **PARA / tag chips** as compact rounded pills (cyan-tinted soft badges).
- **Ask chat**: user bubble `chat-bubble-primary` (cyan); assistant on raised surface.
- Empty states may use subtle **cyan→pink gradient** headings (Ask / Notes / Answer styles).
- Light mode available via navbar toggle; accents stay cyan/pink/mint.

## Friendly UX preserved

- Default mode still **Ask** (`mode === 'chat'`).
- Tabs: **Notes | Find | Ask | Answer styles**.
- Soft AI copy (“AI: ready” / “not available — search still works”).
- PARA chips + Filters disclosure in simple mode.
- **Advanced** toggle + `lkv.uiMode`.
- Hide note ids / scores in simple mode.

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` | clean |
| `npm run test:mvp` | **51 passed, 0 failed** |
| `npx vite build` | clean (daisyUI 5 + blink themes emitted) |

## How to try

```bash
cd /workspace/local-knowledge-vault
npm run dev
```

1. App should open on **Ask** with a **dark navy** canvas and **cyan** primary buttons.
2. Top bar: brand · Find / Ask AI · AI badge · Advanced · **theme circle** (toggle light/dark; preference survives reload via `lkv.theme`).
3. Sidebar ~240px: PARA pills; selected note has cyan left bar.
4. Ask: cyan user bubbles, raised assistant bubbles; empty state gradient heading.
5. Advanced still reveals ids / scores / fuller filters without changing Ask-first labels.

## Out of scope (unchanged)

Buying Blink, brainstorm feature, git commit.
