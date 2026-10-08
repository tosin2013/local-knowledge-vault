# ADR 0004: Study cards

Status: Proposed
Date: 2026-10-08
Issue: #259 (Study: minimum viable exam prep). Tier 2: #261, #262, #263, #264, #265, #273

## Context

Spaced review (#216) scheduled **notes**: `review_schedule` had one row per `items.id`. The Tier 2 work in #259
needs a smaller and more varied unit:

- **#262** enrolls a whole project, and an imported book page or a long note is too much to recall as one prompt.
  Notes have to be split into chunk-sized cards.
- **#263** generates a question/answer pair (with a supporting quote) for each card.
- **#265** turns practice-test misses into cards, some of which carry the test's own question and answer.
- **#273** adds reverse cards.
- **#264** schedules every one of these against the exam date.

If each feature keyed its own table on the note, a long note could have only one schedule, and a practice-test
question could not be graded apart from the note it came from. So the schedule has to key on a card, and every
later feature should share that one card table.

## Decision

**One `study_cards` table, one `card_schedule` row per card and an append-only `review_log`.** Migration v7
creates all three and moves the old note-keyed schedule over.

### `study_cards`

| column | meaning |
| --- | --- |
| `id` | `crd_…` |
| `item_id` | The note the card belongs to. Required: every card is backed by a note (`ON DELETE CASCADE`). |
| `chunk_index` | `note_chunks.chunk_index` for a chunk card. `NULL` = the whole note. |
| `chunk_hash`, `note_hash` | Hash of the chunk text and of the note body when the card was made, so #263 can tell which cards went stale after an edit. |
| `origin` | `note`, `practice-test` or `reverse`. |
| `question`, `answer`, `quote` | Filled by generation (#263), by a practice test (#265) or by reversing a card (#273). `NULL` until then. |
| `source_test`, `source_test_date` | For `practice-test` cards. |
| `source_key` | Unique key that makes enrolment idempotent (for example `note:<item>` or `note:<item>#<chunk>`; later origins add their own prefix). |
| `priority` | Lets missed practice-test questions go first (#264, #265). |
| `status` | `active`, `pending` (for example a card waiting on an unconfirmed AI draft), `suspended` or `retired`. |
| `created_at`, `updated_at` | |

**No project column.** A card's project is its note's `items.project`, read by a join. Renaming, merging or moving a
note between projects then carries its cards along with nothing to keep in sync.

**Chunk ids are not stored.** `note_chunks` rows are deleted and re-inserted with new ids on every body edit, so a
card points at `(item_id, chunk_index)` and keeps `chunk_hash` to detect drift. Until #263 regenerates stale cards, a
chunk card shows whatever chunk now has its index, or the whole note body if that index no longer exists.

### Card unit for note-origin cards

`cardUnitsForNote` is a pure function:

- **Empty body:** no card.
- **Body up to 1,200 characters, or only one chunk:** one whole-note card.
- **Longer body:** one card per `note_chunks` chunk.

1,200 characters is roughly what one recall prompt can cover. Enrolment is idempotent: a note with any note-origin
card counts as already enrolled and nothing is added.

### `card_schedule` and `review_log`

`card_schedule` has the same columns as the old `review_schedule` (due date, interval, ease, reps, lapses, last
grade), keyed by `card_id`. The SM-2 maths in `electron/review.ts` (`scheduleReview`) is unchanged. Every grade
also appends a `review_log` row (grade, time, the resulting interval, ease and due date). Session scores (#262) and
"missed first" ordering (#264) are computed from this log.

### Migration from `review_schedule` (v7)

- **Empty `review_schedule`** (a fresh or never-reviewed vault): the table is dropped.
- **Otherwise**, in one transaction, each row becomes:
  - a whole-note card (`source_key = note:<item_id>`, original `created_at`/`updated_at`);
  - a `card_schedule` row with the same due date, interval, ease, reps, lapses, last grade and last-reviewed time;
  - a `review_log` row marked `migrated = 1` when the note had been graded. The old table kept only the last grade,
    so that one grade is the whole history there is to carry over.
- **Then** the old table is renamed `review_schedule_legacy` rather than dropped, so no data is lost if anything has
  to be checked or rolled back. It can be dropped in a later release.

Migrated cards stay whole-note cards even for long notes, so an existing schedule is not reset. Re-enrolling such a
note (after removing it) splits it into chunk cards.

### IPC compatibility

- `review:rate` takes `cardId`. A legacy `itemId` grades that note's first card.
- `review:enqueue` still takes an `itemId` and returns `{ created, cards, alreadyEnrolled }`.
- `review:listDue` returns one row per due card: the note fields plus `card_id`, `chunk_index`, `chunk_count`,
  `card_text`, `origin`, `question`, `answer` and `quote`.
- `review:remove` removes all of a note's cards.

### Exam date per project (#261, migration v8)

Projects are derived from `items.project`, so settings live in a separate `project_settings` table
(`name` primary key, `exam_date`, timestamps):

- **Rename:** the row moves with the project.
- **Merge:** the destination keeps its own date, or takes the source's if it has none.
- **Delete:** the row is removed.

A card's exam date is read at grading time from its note's *current* project. A note with no project, and the "All
projects" scope, has no exam date and gets plain spacing.

The old ReviewView "Target exam date" was component state passed to one `review:rate` call and never stored, so
there is nothing to migrate onto projects. The IPC no longer takes a date from the caller.

### Study this project (#262)

`review:enqueueProject(project)` enrolls every live note in a project at the card unit. It is idempotent: a note that
already has cards counts as "already scheduled" and is left alone. It returns
`{notes, cards, alreadyScheduled, skipped[{itemId, title, reason}]}`, which Study home shows as
"N notes → M cards, K skipped".

These are left out, each with a reason (`enrollSkipReason`, pure):

- **Unconfirmed AI drafts** (`status = 'ai-draft'`): enrolled after the own-words confirm (#217). The evaluation found
  0 of 2 usable questions from drafts.
- **Video transcripts:** a learner adds single parts from Review by choice, as the evaluation decided.
- **Archived notes.** Trashed notes are ignored and not listed.
- **Empty notes and stubs:** an own note under 3 real words, or an imported page under 20 (after dropping
  `Source:`/`Page:` header lines).
- **Boilerplate, on imported pages and articles only** (`boilerplateReason`). The learner's own notes, pasted ones
  included, are never skipped as boilerplate: a short own note is a good card, and the evaluation's messy pasted
  printer page still holds the learner's material. Signals are grouped (copyright, exam logistics, exam policy, site chrome,
  blank page, contents), so a header repeated on every page counts once. A page is skipped when:
  - two or more groups match;
  - three or more exam-logistics phrases match (an exam cover or instructions page); or
  - one group matches on a page of 120 words or fewer.

  A long content page that carries one copyright header is kept.

### Exam-aware spacing (#264)

All of these are pure functions in `electron/review.ts`, with unit tests in `scripts/review-smoke.ts`.

- **Days to the exam** (`calendarDaysUntil`): local calendar days, so 1 = tomorrow and 0 = today.
- **Interval cap** (`capIntervalForExam`, applied inside `scheduleReview`): let `remaining = daysLeft − 1`, since the
  last useful review day is the day before the exam.
  - No cap when there is no exam date, when the exam is today, tomorrow or past (plain SM-2 resumes after it), or
    when the card is due now.
  - If `remaining ≤ 3`, the interval is at most `remaining`, so the last review lands on the day before the exam.
  - Otherwise, an interval over half the remaining time becomes `floor(remaining / 2)`, so another review still fits
    before the final one.
  - Worked example: a card answered Got it every time with the exam 14 days out is seen on days 0, 3, 8, 10 and 13.
- **Daily new-card budget** (`newCardBudget`): `ceil(remaining new ÷ max(1, days left − 2))`, at most 25; 25 with no
  exam.
  - Regents in 14 days with 60 chunks → 5 a day.
  - A+ in 30 days with 150 cards → 6 a day.
  - The budget is worked out from the cards that were new at the start of the day, so it stays the same during the
    day. Each project has its own budget.
- **Coverage warning** (`unreachableNewCards`): `remaining new − 25 × max(1, days left − 2)`. Study home and Review
  show "N cards won't be reached before your exam" instead of cramming them in.
- **Queue order** (`buildReviewQueue`):
  1. missed (Again) cards;
  2. Partly (Hard) cards;
  3. other due cards, by due date;
  4. today's new cards, in priority then reading order, within each project's budget.

  Review puts a missed card back at the end of the current session.
- **One grading scale:** Missed / Partly / Got it, stored as `again` / `hard` / `good`. Easy is gone from the UI;
  stored `easy` grades are kept and read as Got it. `review:rate` accepts both scales.

## Consequences

- One schedule per card: a 30-page book can be enrolled at page or chunk level and each part is graded on its own.
- Practice-test cards (#265) and reverse cards (#273) need no new tables: they are rows with a different `origin` and
  `source_key`. A practice-test question with no confirmed note is a `pending` card on its AI draft until the user
  confirms it.
- Deleting a note deletes its cards, schedules and history (cascade). Trashing or archiving hides them from the
  queue.
- `review_schedule_legacy` stays in migrated vaults until a later release drops it.
