# Terminology

One user-facing term per concept. This glossary is the source of truth for Vault's UI copy, the
README, and any string the user sees. Internal code identifiers (TypeScript types, IPC method names,
`plugin.json` keys) keep their historical names where noted below.

## Concepts

| Concept | Canonical term | What it is | Retired terms (do not use in UI) |
|---|---|---|---|
| Reusable instructions that shape how Ask answers | **Personality** | A named set of tone/format instructions (a `prompts` row). Pick one in **Ask → Customize**, or manage them in the **Personalities** pane. | Prompt, Persona |
| The same idea in Media chat | **Voice** | A personality bound to Media chat (a "voice pack"). Pick one as a **voice chip**; install built-ins or add your own in the **Media voices** panel. | Persona |
| A saved setup: one personality + one project scope | **Profile** | Saved from **Ask → Customize → Save as profile**, so a personality + scope can be re-picked in one step. | — |
| The bucket a note lives in | **Group** | The PARA categories: **Projects**, **Areas**, **Resources**, **Archives**. | PARA, Note group |
| The named topic a note belongs to, and the scope Ask retrieves from | **Project** | Free-text name on a note, e.g. "Local Knowledge Vault". Also the Ask retrieval scope. | Notes from |

## Notes

- **Personality vs. Voice.** Both are the same underlying thing (a `Prompt` record) in two surfaces.
  Ask uses **Personality**; Media chat uses **Voice** (voice packs / voice chips). **Persona** is the
  historical name that survives only in code (e.g. `media:createPersona`) and the `plugin.json`
  `personas` key; it maps to a Voice.
- **Group ("Projects") vs. Project.** A note has both a **Group** (`para`: one of Projects / Areas /
  Resources / Archives) and a **Project** (a free-text name). These are different concepts whose
  words collide: the Group value "Projects" is not the same as a note's "Project" field. The field /
  retrieval scope is being promoted to a first-class, renameable, mergeable and deletable project
  (see issue #133).
- **Profile** bundles a Personality and a Project scope; saving a profile never creates a new
  personality.
