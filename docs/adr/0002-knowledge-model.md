# ADR 0002: Knowledge model — Sources → Notes → Answers

Status: Proposed
Date: 2026-09-29
Issue: #135 (Media chat: build on the knowledge in a video)

## Context

Vault promises three things today, and states only two of them:

- **Trust** — every answer cites the note it came from, or says it doesn't know (README, grounding
  contract in `electron/generate.ts` / `chat.ts`).
- **Local-first** — notes live in local SQLite.
- **PARA organization** — `para` (`projects`/`areas`/`resources`/`archives`) is in the schema but
  only as a label.

What has never been written down is how knowledge **accumulates**. Today it flows one way:

1. A video becomes ~45–80 raw transcript chunks (`Media — mm:ss–mm:ss`, #119) that sit in the notes
   list as equals of the user's own notes (#120).
2. Ask and Media-chat answers are ephemeral — there is no "save answer as note" and no way to turn a
   transcript moment into the user's own note (no such action exists in `src/` or `electron/`).
3. So nothing a user learns from a video becomes part of their knowledge except the raw transcript.

Four models were considered. Each was compared against Vault's existing promises (trust,
local-first, PARA):

| Model | Trust fit | Accumulation | Verdict |
|---|---|---|---|
| **Source-grounded retrieval (status quo)** | Strong | None — nothing is distilled | Fails the accumulation goal |
| **Second brain / progressive summarization** | Strong | Capture → organize → distill → express | Right shape, but no source/derived distinction; PARA is already half-adopted, the *distill* step is missing |
| **Zettelkasten / evergreen notes** | Strong | Atomic notes, linked | Adds a linking/atomicity model Vault has no UI for; heavier than needed now |
| **Layered (Sources → Notes → Answers)** | Strongest | Sources immutable, Notes distilled from sources and citing them, Answers ephemeral unless saved | Fits trust (derived notes still cite), local-first (no new store), and PARA (labels on notes) |

## Decision

**Commit to a layered knowledge model with three layers, in retrieval order.**

1. **Sources** — immutable passages the user brought in: transcript chunks, URL imports. Grouped as
   one item per source rather than many equal notes (#120). Sources are never edited in place; they
   are re-ingested.
2. **Notes** — the user's own, distilled, in-their-own-words notes. A note **cites the source moment
   it came from** (source URL + `t_start`/`t_end`, and the `[itm_…]` ids it drew on). The grounding
   contract extends to derived notes: a note about a video cites the transcript moment, so a later
   answer citing that note is still traceable to the source.
3. **Answers** — ephemeral by default. When an answer (Ask or Media chat) is saved, it becomes a
   Note, keeping its citations and provenance, and is **marked an AI draft until confirmed** (#137).

### Media chat interaction model

Derived from the model: users come to a video with a **task**, not a character.

- Primary: **task actions** — *Summarize*, *List the steps*, *Find the moment*, *Quiz me*, *Check the
  claims*. Task choices are offered by **video category** (yt-dlp already provides `categories`, and
  often `chapters`).
- Secondary: **voice** (today's persona chips) becomes a *Style* option that only changes how the
  answer sounds, never what it does.
- A fully generated per-video persona is rejected: unpredictable, an extra model call, opaque to the
  user. (ADR 0003, proposed, amends this sentence: a character the user asks for, reviews and saves is
  allowed; an automatic per-video persona is still rejected.)

### Settling the open questions for #137 and #138

- **AI-draft flag** lives as a **`status` value** (`ai-draft`, alongside `active`/`archived`) plus a
  provenance header in the note body. No new column. Retrieval treats `ai-draft` notes as
  rank-deprecated: they never outrank the source passages they cite until the user confirms them
  (edits → `active`). Model text never becomes authority merely by being saved.
- **Retrieval** is **notes-first**: user Notes rank before Sources (transcript chunks) for a given
  query, with a scope control (Notes / Media / Everything) and a visible marker of whether support
  came from a note or a transcript. This is a *hypothesis to test on the real code first* (#138);
  Media chat stays transcript-first because it is chat with the video.

## Evidence

1. **Model comparison** — the table above; the layered model is the only one that satisfies all three
   promises *and* adds accumulation without a new store or a linking/atomicity UI.
2. **Video walkthrough** — not yet run; filed as a follow-up (#146) to validate task-actions over
   persona chips across tutorial / lecture / podcast / news / review videos.
3. **yt-dlp metadata** — `categories` and `chapters` availability is assumed, not measured; filed as
   a follow-up (#147) to confirm chapters yield usable note titles.
4. **Retrieval check** — notes-vs-transcripts ranking is measured against the real `searchQuery` in
   #138, not simulated.

## Consequences

- **Positive:** derived notes stay traceable to sources; accumulation becomes possible; the
  transcript flood (#120) and generic media titles (#119) get a principled fix; Media chat gains
  task actions.
- **Negative:** Sources and Notes must be distinguishable in the UI and in retrieval, which is new
  surface area; re-ingesting a source must not break citations to derived notes (#124).

### Follow-up candidate issues

| Work | Issue | Status |
|---|---|---|
| Media transcript notes get real titles (chapters) | #119 | open |
| Notes rail groups a source as one item (no transcript flood) | #120 | open |
| Notes-first retrieval + Notes/Media/Everything scope | #138 | open |
| Save an answer / video moment as a note (AI draft until confirmed) | #137 | open |
| Citation markers render as real chips, not raw text | #129 | open |
| Re-ingest must not break citations to derived notes | #124 | open |
| Task actions by video category (walkthrough) | new (#146) | filed here |
| yt-dlp `categories`/`chapters` availability check | new (#147) | filed here |

The grounding contract is unchanged by this ADR: `electron/generate.ts` and `electron/chat.ts` still
require citations to retrieved ids or an honest "I couldn't find that in your notes".
