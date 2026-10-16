# Changelog

All notable changes to Vault. Versions match the `vX.Y.Z` tags on the
[Releases page](https://github.com/tosin2013/local-knowledge-vault/releases); the release workflow
uses the matching section below as the release notes.

## [0.4.0] — Study for exams, faster big vaults

Vault becomes a study tool: a top-level **Study** tab turns your notes into spaced, exam-aware
practice, and large vaults stay responsive. This release also completes the v0.4.0 test milestone
(renderer tests and 80% coverage) and most of v0.4.1 (performance).

### Study tab and exam prep
- **Study tab** next to Ask and Find (Ask → Find → Study); Study, Review and Test to notes moved out of add-ons. (#269)
- **Exam dates per project** and a Study home with per-project stats, coverage and "Study this project". (#283, #284)
- **Card-level scheduling** instead of per-note, with exam-aware spacing, a daily new-card budget and missed-first order; edits rebuild only the changed sections. (#282, #285, #287)
- **Study sessions**: attempt first, then reveal, rate your confidence, and get a session summary with calibration. (#288, #228)
- **Practice tests**: import a practice test into Study and enrol it automatically; turn results into grounded corrective notes. (#290, #224)
- **Two-way (reverse) cards** for acronym, port and term lists, e.g. CompTIA A+ acronyms. (#291)
- Spaced review for notes (SM-2 style), sample questions drawn across the whole scope, and an own-words step before an AI draft becomes a note. (#227, #278, #226)
- Structured output is guarded against reasoning-model token budgets; rate-limit (429) errors are reported as such instead of "AI offline". (#307, #281)

### Imports
- **Books**: import EPUB and text-layer PDFs as checkable notes; PDF import strips repeated headers, adds section titles and rejoins sentences split across pages. (#223, #279, #280)
- **Every import asks which project it files into.** (#313, closes #276)
- Long notes are chunked for retrieval. (#258)

### Performance
- Imports, book parsing and enrollment run in a **background job worker** instead of the main thread, so the app no longer freezes during a 2,000-note import (2.9 s) or a 5k-note enrollment (3.6 s). (#312)
- SQLite tuning and indexes on the hot item queries: listing all items 292.6 ms → **55.2 ms (5.3×)**, `listProjects` 24.4 → 0.5 ms, `countItems` 22.3 → 0.1 ms on a large vault. (#311)
- The notes list is windowed (bounded DOM: 350 notes render 100 rows in under 2,000 nodes), rail queries are debounced, and typing no longer re-renders the rail. (#309, #310, #308)
- Stopped an idle re-render/re-fetch loop at startup. (#306)

### Providers and app
- Cloud answers are flagged, with an **Auto (local-only)** mode; Ollama Cloud sends the API key and has a preset. (#200, #256)
- Single-instance lock, real bridge version, and a notice when a newer release exists. (#201)
- Personalities: more templates, preview, JSON export/import. (#222)
- Honest "not in your notes" answers are no longer flagged as uncited. (#243)

### Fixes
- The job worker is emitted in dev and packaged builds, so imports and enrollment work in installed apps. (#316, #314)
- Chat recovers when you send into a session that was deleted. (#317, #315)
- Review: the due card no longer collapses when the view overflows. (#277)

### Project
- Renderer test suite and an 80% main-process coverage gate in CI (v0.4.0 milestone). (#206)
- Node 22 requirement declared (`engines`, `.nvmrc`); contributor on-ramp (code of conduct, templates). (#245, #232)
- Release workflow checks the tag against `package.json`, tests before building, and smoke-tests the packaged job worker. (#319)

### Known issues
- Windows and macOS builds are unsigned; see the README for the SmartScreen and Gatekeeper steps.
- Study home and session start can still take 1–3 s on a 5,000-note vault (#296, v0.4.1).

## [0.3.0] — Answer quality & robustness

See the [v0.3.0 release](https://github.com/tosin2013/local-knowledge-vault/releases/tag/v0.3.0).

## [0.2.0] — Security follow-ups

See the [v0.2.0 release](https://github.com/tosin2013/local-knowledge-vault/releases/tag/v0.2.0).

## [0.1.0] — First release

See the [v0.1.0 release](https://github.com/tosin2013/local-knowledge-vault/releases/tag/v0.1.0).
