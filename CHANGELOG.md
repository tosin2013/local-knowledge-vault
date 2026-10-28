# Changelog

All notable changes to Vault. Versions match the `vX.Y.Z` tags on the
[Releases page](https://github.com/tosin2013/local-knowledge-vault/releases); the release workflow
uses the matching section below as the release notes.

## [0.6.0] — Study a video

Media chat becomes a place to study a lecture, not just ask about it: mark moments, get quizzed
before you're told, and write your own study guide while Vault checks it against the transcript.

### Media chat
- **Video bookmarks**: press **B** to save the playhead, then label and tag it, see it as a tick on the timeline, jump back, ask about it, summarize them all, or turn them into Study cards. (#334)
- **Exam tutor voice**: a built-in Media voice that asks first, gives hints in steps, and shows the cited answer only after you've tried. (#364)
- **Notes while watching**: start a study guide or research notes beside the player (fullscreen too). You write at checkpoints (chapter boundaries or every N minutes) and Vault checks your entry against the transcript and cites it. (#365)

### Study
- Study home, session start and the session summary load only the cards a session shows, and count the queue without loading every card body. (#296)

### UI
- Moved to MUI 9. Switches are announced as switches to screen readers. (#372)
- At 1280×800 the notes list keeps room for several notes, and the local **Model** label no longer overlaps "Auto-pick". (#373, #374)

### Platform
- Electron 45. (#358)

### Docs
- README "Study a video" section and video guide screenshots for bookmarks, Exam tutor and the study guide. (#268)

## [0.5.0] — Media chat you can study with

Media chat goes from a preview to a real study tool. Local videos (file + captions) and YouTube
lectures now seek reliably, fullscreen keeps the same player, sessions persist across visits, and
answers are grounded in the moment you're watching — not a timestamped full-library search.

### Media chat
- **Local videos seek** — the `lkvmedia://` handler serves HTTP range requests (206 + `Content-Range`), so citation seek, scrubbing and resume work on long files instead of snapping back to 0:00. (#326)
- **Fullscreen doesn't restart the player** — the player mounts once and fullscreen is a CSS overlay on the same subtree, so the YouTube player stays bound and playback continues. (#327)
- **Citations work in fullscreen** — a citation click shows the passage inside fullscreen instead of opening a hidden drawer, and Esc keeps working. (#328)
- **Sessions persist** — the open video, chat history, playhead and voice are remembered across visits, tab switches and restarts; one video keeps one continuing session (a "New chat" button starts fresh). (#329)
- **The playhead tracks pauses and scrubs** — "Ask about this moment" and "Save this moment" use the player's real position, and the near-playhead count settles after a seek. (#330)
- **"Save this moment" reads in order** — the transcript passage is saved chronologically with readable `[1:44:20]` timestamps and no machine-metadata lines. (#331)
- **Follow playhead scopes retrieval** — answers are grounded in the notes around the current moment, over a configurable window (±30 s / ±45 s / ±1 m / ±3 m). (#161)
- **The ingest panel collapses** once a video is loaded, so the player, its controls and the composer fit a laptop screen. (#332)
- **Answers and the cited passage render Markdown**, matching Ask and Study. (#353)

### Study
- Practice-test questions can be asked as multiple-choice, and wrong picks are remembered. (#324)

### Docs
- Retaken README screenshots, a new social preview, and guides that describe `[1]` citations. (#323)

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
