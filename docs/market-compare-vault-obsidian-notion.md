# Vault vs market demand — Obsidian & Notion

*Draft for Decision Crafters / Vault product positioning. Not a formal research report; grounded in how these products are used and how Vault is built today (local SQLite, grounded Ask, Media chat, Profiles).*

## What buyers actually want (notes + AI)

| Demand | What “good” looks like | Pain if missing |
|--------|------------------------|-----------------|
| **Capture → find → use** | Fast put-away, search that finds the right chunk, answer with proof | Notes become a graveyard |
| **Trustable AI** | Answers cite sources; admits gaps | Hallucinated “second brain” |
| **Low ceremony** | Cold open without graph/plugins/schema homework | Abandon after setup weekend |
| **Own the data** | Local or exportable; not locked to one cloud UI | Switching cost / policy risk |
| **Media → knowledge** | Video/audio becomes searchable notes you can ask | Transcripts live in YouTube forever |
| **Voice without lying** | Personas/styles that don’t invent facts | Fun chat that breaks trust |

Vault is explicitly aimed at the **trust + low ceremony + media→notes** slice. Obsidian owns **flexible PKM**. Notion owns **team workspace + docs**.

---

## Scorecard (0–5): closeness to Vault’s bet

Rubric: 5 = strong fit for that demand *as Vault defines it* (grounded local Ask, simple home, media ingest).

| Demand | Vault (now) | Obsidian | Notion |
|--------|-------------|----------|--------|
| Capture → find → use | **4** — FTS + filters + Ask; PARA/kinds | **4** — powerful search/links; steep layout tax | **4** — databases/search; cloud-first |
| Trustable AI (citations / “I don’t know”) | **5** — core design (itm_ cites, book/media-bound prompts) | **2–3** — AI via community plugins; quality varies; not one product contract | **3** — Notion AI is helpful but workspace-wide; citation discipline is weaker than Vault’s item IDs |
| Low ceremony / non-technical cold open | **4** — Ask-home, Profiles, Simple mode (still early polish) | **2** — plane cockpit: graph, plugins, templates, sync choices | **3** — polished UI, but “what is a database / relation / view?” is its own jargon |
| Own the data (local-first) | **5** — SQLite on device | **5** — markdown on disk | **2** — cloud workspace; export exists but product is hosted |
| Media → searchable notes + Ask | **4** — Media chat plugin (YouTube/local captions → transcript notes + player Ask + fullscreen) | **2** — possible with plugins/pipelines; not a first-class loop | **2** — embeds/media blocks; not caption-chunk → grounded chat |
| Swappable personas / voice packs | **3** — Personalities + Profiles; Media personas plugin in progress | **2** — prompt/system messages via plugins; no standard “grounded voice pack” | **2** — custom agents/instructions in places; not note-bound media voices |
| Team/collab wiki | **1** — single-user local today | **2** — Sync/Publish/Share; still file-centric | **5** — native multiplayer |
| Extensibility ecosystem | **2** — in-app plugin registry (early) | **5** — huge plugin/theme market | **4** — API, templates, marketplace |

**Overall “how close is Vault to winning its chosen game?”**  
Against Obsidian on **local + flexible notes**: Obsidian still wins breadth; Vault is closer on **AI trust + Ask-home simplicity + media loop**.  
Against Notion on **everyday knowledge work**: Notion wins collab and polish; Vault is closer on **local ownership + grounded answers + video→notes**.

Rough distance metaphor (chosen game = “local grounded Ask over my notes/media”):

- Vault → target: **~70%** of a lovable v1 (Media chat + Profiles + cites are the wedge).
- Obsidian → same target: **~40%** (you can assemble it; default product doesn’t ship the loop).
- Notion → same target: **~35%** (great workspace; wrong default for local grounded media memory).

---

## Obsidian: why it feels confusing

Obsidian’s strength is also the confusion: **you assemble the product**. Graph, Canvas, daily notes, Dataview, Templater, Copilot/Smart Connections, sync vs iCloud vs git — power users thrive; non-technical users bounce. AI is a **plugin quilt**, not a single “answers only from these notes with stable IDs” contract.

**Vault should not copy the cockpit.** Keep Ask as home; plugins optional (Media chat, Media personas); notes as proof rail.

## Notion: why “it’s Notion”

Notion is the default for **teams, docs, and structured work**. AI sits on top of a cloud graph of pages/databases. That is excellent for company wiki and project tracking; it is a weak default for “this YouTube transcript is my memory and the model must cite chunk notes.”

**Vault should not become Notion.** Stay local, stay citation-hard, stay Media→notes. Interop later (export citation packs, optional sync) without becoming a multiplayer doc suite first.

---

## OpenPersona angle (after Media personas land)

OpenPersona = persona **lifecycle** (Soul/Body/Faculty/Skill, evolution, memory faculties).  
Vault = **grounded voice packs** over canonical notes.

Safe partnership message:

> Vault supports Media voice-pack personas (Personality prompts bound to transcript projects). Speaking style can map from an OpenPersona Soul declaration. Vault notes remain the knowledge store; Vault does not run OpenPersona evolution/memory as authority over facts.

That lets you “let OpenPersona know we support this” without absorbing their whole stack.

---

## What to build next (priority for market wedge)

1. **Ship Media personas plugin** (Desk cohost / Curious student / Skeptical investor) — fun without lying.
2. **One-click “use with this media project”** — Profiles already exist; make the path obvious in Media chat.
3. **Sharpen cold open** — topic offers from notes (deferred earlier) only if it stays non-jargon.
4. **Defer** Obsidian-like graph and Notion-like multiplayer until the media+grounded Ask loop is sticky.

---

## One-line positioning

**Vault:** local notes that answer honestly — especially after you watch something.  
**Obsidian:** private linked thinking you shape yourself.  
**Notion:** the team’s working docs and databases.
