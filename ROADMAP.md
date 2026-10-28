# Vault roadmap

This file is the **roadmap of record** for Vault. It names and orders features; it doesn't design
them. GitHub milestones, labels and boards are *views* of it. When they disagree, this file wins,
and the view gets fixed. The method follows the
[PLAYBOOK](https://github.com/tosin2013/invoice-exception-desk/blob/main/PLAYBOOK.md)
("PM: plan the roadmap first").

## Destination (6–12 months)

**Within 12 months, a self-directed certification or licensing candidate can prepare for a real
exam entirely in Vault (their notes, PDFs and course videos, kept local) on a schedule built
around their exam date, and a pre-registered pilot (#218) has measured whether it helps.**

Why this user: free cloud tools such as NotebookLM now offer generic flashcards and quizzes grounded
in your sources. Vault's edge is the combination:
- local by default
- cites or says it doesn't know
- you attempt before you're told
- spacing built around an exam date, with confidence calibration
- studying from lecture video

Certification candidates often study from material they can't or won't upload, against a fixed
date, with a pass/fail result. That this is the right user is a **hypothesis**; R10 tests it.

## Now / Next / Later

- **Now** (fully scoped): R1 to R5. Ship v0.6.0, adopt Spec Kit, then measure retrieval before
  building more of it.
- **Next** (sketched): R6 to R9. Close v0.4.1, then course import, offline proof, and one full exam
  cycle.
- **Later** (one line each): R10 onward. Pilot, signed installers, contributor on-ramp, characters.

## Roadmap

| ID | Feature | One-line scope (in / out) | Outcome | Depends on | Order | Milestone | Status | Spec dir | Issue / PR |
|---|---|---|---|---|---|---|---|---|---|
| R1 | Usable at 1280×800 | in: notes-rail height, provider label overlap / out: other layout | the rail shows ≥5 notes and the Model label doesn't overlap "Auto-pick" at 1280×800 | — | 1 | v0.6.0 | building | — | #373, #374, PR #377 |
| R2 | Release v0.6.0 on Linux, Windows, macOS | in: pre-release tag support, CHANGELOG, release dry run, per-OS checklist, RC then final / out: code signing (R11) | v0.6.0 published after the `docs/release.md` checklist passes on all three OSes | R1 | 2 | v0.6.0 | building | — | PR #378 |
| R3 | Adopt Spec Kit (L0) | in: inventory, constitution from the real code (grounding contract, local-first, keys never over IPC, tests land with code, builder-written tests alone never mean done), recorded test baseline / out: Ralph, sandbox, unattended runs | an approved constitution and test baseline are committed | — | 3 | v0.7.0 | planned | — | — |
| R4 | Retrieval eval on a long certification text | in: one openly licensed long certification-style text, about 50 exam-style questions each with a gold passage, a repeatable script reporting recall@5 and the false "not found" rate / out: embeddings, UI | baseline numbers recorded, plus a written build/skip decision for R5 | R3 | 4 | v0.7.0 | planned | — | #219 (partial) |
| R5 | Optional local hybrid search | in: local embeddings plus BM25, off by default, grounding contract unchanged / out: cloud embeddings | the R4 eval clears the threshold R4 sets; otherwise this row is dropped with the eval as the reason | R4 | 5 | v0.7.0 | planned | — | #219 |
| R6 | Close v0.4.1 performance | in: a repeatable perf check, close the tracking issue / out: new perf work | the perf script runs on demand and the v0.4.1 milestone is closed | — | 6 | v0.4.1 | planned | — | #297, #300 |
| R7 | Course-material import for certification prep | sketch: bulk import of a local video course folder with captions; cleanup for long PDF guides | a whole course imports into one project in one action | R4 | 7 | v0.8.0 | planned | — | — |
| R8 | Offline and privacy proof | sketch: a "local only" mode plus a test asserting no outbound requests | a test proves zero network calls in local-only mode | — | 8 | v0.8.0 | planned | — | — |
| R9 | Exam cycle end to end on one real certification | sketch: import, enrol, exam-date spacing, practice test, readiness view; includes help panel and interleaving | one full walkthrough on a real certification dataset, with gaps logged | R4, R7 | 9 | v0.8.0 | planned | — | #266, #267, #268 |
| R10 | Pilot-ready | pre-registration, consent, de-identified log export, then run the pilot | the pilot can start | R8, R9 | 10 | v0.9.0 | planned | — | #218, #230, #231 |
| R11 | Signed installers | in: macOS Developer ID and notarization; Windows signing (Azure Artifact Signing, or SignPath Foundation for open source) / out: Linux, which needs no signing | no "Open Anyway" step on macOS; a signed Windows installer | R2 | 11 | — | blocked — needs the owner's purchase decision (Apple Developer Program as an individual; a Windows signing service); reopen about two weeks before the Windows and macOS release | — | — |
| R12 | Contributor on-ramp and plugin doc drift | contributor guide, issue templates, plugin docs that match the loader | an outside contributor can start in one sitting | — | 12 | — | planned | — | #229, #169 |
| R13 | Characters, personas, plugin ecosystem | character generation, follow-up chips, plugin schema and CLI, code-plugin research; reopen when R10 shows the core study loop helps | — | R10 | 13 | — | planned | — | #165, #167, #168, #170, #202–#210 |

**Status** is one of:
- `planned`: no reviewed spec yet
- `specified`: has a reviewed spec
- `building`: underway, exit criteria not all met
- `blocked — <reason>; reopen when <condition>`
- `done`: full exit criteria met and accepted by the row's reviewer
- `dropped — <reason>`: a dropped dependency is not satisfied

IDs never change. **Order** is priority, lowest first. Rows are picked by dependencies first, then
the riskiest assumption, then value.

R1 and R2 started before Spec Kit (R3), so they have no spec dir. The drift check warns about
that for `building` rows; the warning is expected until they're done.

## Not roadmap rows

These get a normal PR, with no spec and no row:
- dependency bumps and Dependabot (#241 npm audit)
- clean-ups (#289 drop the legacy review table)
- presets (#254 vLLM)
- small Media chat polish (#146, #147)

## Who updates what

| When | Who | Change |
|---|---|---|
| Plan or replan | the owner | Add, reorder, re-scope, block or drop rows, and log why below. Update this file first, then the specs it affects. |
| A spec is written and reviewed | whoever ran it | `planned` → `specified` and add the spec dir, in the same commit as the spec |
| Work starts | the author | → `building` |
| A PR lands part of a row | its author | add the PR link; the row stays `building` |
| The change that meets the row's full exit criteria | its author proposes, the row's reviewer accepts, a human merges | → `done`, with the evidence links |

A merged PR or a green suite alone is not `done`. Check that the spec, tasks, this file and the
linked issues all describe the same scope. `.github/workflows/roadmap-drift.yml` checks the table's
structure on every change. It only warns, and it never decides that a row is done.

## Specs outside this roadmap

None yet.

## Replan log

### 2026-10-28: first roadmap

- **Destination** chosen as certification and licensing candidates. Rejected alternatives: a
  general "honest local second brain", which is a crowded field of small local apps and Obsidian
  plugins and has no measurable finish line; and "learn from video first".
- **Retrieval correction.** Long notes are already chunked (`electron/chunking.ts`; Ask uses the
  matched chunk, `electron/generate.ts`). The open risk is therefore not "only the first 1,200
  characters reach the model". It is whether keyword search finds paraphrased exam questions. R4
  measures that before R5 builds embeddings.
- **Release first.** A lot of finished work (bookmarks, Exam tutor, study guide, MUI 9, Electron
  45) was unreleased, so R2 ships it as an RC: Linux is verified now, Windows and macOS next month.
  Signing (R11) waits on a purchase decision.
- **Characters and personas** move to Later (R13), off the shipped v0.5.0 milestone. Their issues
  stay open.
- **Milestones:** v0.6.0 is this release, v0.7.0 retrieval, v0.8.0 the exam cycle, v0.9.0
  pilot-ready.
