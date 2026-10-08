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
card points at `(item_id, chunk_index)` and keeps `chunk_hash` to detect drift. Edits re-map cards onto the new
sections (see "Editing a note", #286), so `chunk_index` always names the card's current section.

### Card unit for note-origin cards

`cardUnitsForNote` is a pure function:

- **Empty body:** no card.
- **Body up to 1,200 characters, or only one chunk:** one whole-note card.
- **Longer body:** one card per `note_chunks` chunk.

1,200 characters is roughly what one recall prompt can cover. Enrolment is idempotent: a note with any note-origin
card counts as already enrolled and nothing is added.

### Editing a note (#286)

When an enrolled note's body changes, `updateItem` re-derives its chunks and then calls `syncNoteCards` (through the
`onNoteBodyChanged` hook, so every write path is covered). The owner's rule: rebuild only the sections whose hash
changed. `planSectionSync` (pure) maps the existing note-origin cards onto the new sections:

1. **Unchanged** (a section's hash equals a card's `chunk_hash`): the card, its schedule and its `review_log` stay;
   only `chunk_index` moves if the section moved. A retired card whose exact text comes back (an undo) is revived.
2. **Edited** (no hash match, but the old text of a live card is at least 50% similar by word-set Jaccard, function
   words ignored): the same card and schedule, with the new hash and its question, answer and quote cleared so they
   are rebuilt. This step exists because chunking is greedy: one inserted sentence shifts every later chunk boundary,
   and without it a one-line edit near the top of a long note would reset every section below it.
3. **New** sections get new cards (due now). Their `source_key` is `note:<item>:<card id>`, since a kept card may now
   sit at the index a positional key would use.
4. **Removed** sections: the card is set to `retired`. Its schedule and history stay in the database, but it leaves
   the queue and the stats. Nothing is hard-deleted.

Notes with no note-origin card (not in Study) are left alone, and title-only edits or same-body saves change nothing.

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

### Study session (#263, schema v9)

The session loop lives in `electron/study-session.ts` (IPC `study:startSession`, `study:cardQuestion`, `study:answer`,
`study:sessionSummary`) and `src/features/study/StudySession.tsx`.

- **Start:** `buildReviewQueue` for the scope, at most 20 cards (missed first, then Partly, due, new within the
  budget). A session id ties the attempts together.
- **One question per card, generated when the card first comes up**, not at enroll. Enrolling a 178-page book would
  otherwise cost hundreds of model calls at once (Groq's free tier allows about 130 a day), most for cards that won't
  be due for weeks. The session asks for the current card and prefetches the next one, so at most one call is ahead of
  the learner. Each call sends one section (the card's chunk, or the note body) through the grounding contract
  (`buildGroundedMessages`) and asks for one free-recall question, a short answer and a verbatim quote, as JSON.
- **Validation:** the quote must appear in the section (ignoring spacing, case, curly quotes and Markdown); the
  question must not copy six or more words in a row from it, must not be multiple choice, must not ask about "the
  passage"/"the note", and must not need content outside the section; a cited id other than the card's note fails
  `validateCitations`. A card the model declines (`[]`) or a question that fails validation gets a deterministic
  fallback, cached with the reason in `q_note`: a fill-the-gap (cloze) from a sentence of the section, blanking its
  strongest term (acronym, number, proper noun, long word), or, if no sentence works, "Explain … in your own words"
  with the section shown on reveal. An empty reply (a reasoning model that spent its budget thinking, #275) is
  retried once with a 3,000-token budget. Rate limits, the daily cap and offline providers also get the fallback, with a
  notice naming the reason, but are **not** cached, so the next session tries the model again. Provider error text
  is never shown.
- **Cache:** `study_cards.question/answer/quote` plus `q_kind` (`generated`, `cloze`, `explain`, `test`, `pair`),
  `q_source_hash` (hash of the section the question was written from), `q_model`, `q_at`, `q_note`. A note card's
  question is reused while `q_source_hash` matches its section; an edit that changes the section (#286) clears it.
  Practice-test and pair cards keep the question they were created with.
- **Attempt before reveal:** Reveal stays disabled until the learner types an answer or chooses **I don't know**
  (stored as confidence 0). Confidence (0–100) is set before the reveal.
- **Feedback:** the stored answer, the quote, the cited note (opens it) and the whole section on demand.
- **Grade:** Missed / Partly / Got it → `rateReview` (exam-aware SM-2) and one `study_attempts` row with
  `card_id`, `item_id`, `session_id`, `grade`. A missed card goes to the end of the session queue.
- **Summary** (first try per card): Got it / Partly / Missed counts, retried cards, accuracy (Partly = ½),
  calibration (mean confidence vs mean score), confident misses (confidence ≥ 70, not Got it) listed first, notes
  to revisit, the next due date and the number of cards due by the end of tomorrow (new cards counted only as far
  as the daily new-card budget lets them in).
- **Add one note:** the note search in the Study session section asks `review:enrolled` and shows "Already in
  Study" for notes that already have cards.
- **Migration v9** only adds nullable columns (`study_cards.q_*`, `study_attempts.card_id/item_id/session_id/grade`)
  and an index; existing cards, schedules and logs are untouched.

### Practice tests (#265, schema v10)

Past exam papers and practice-test results are **practice tests, not notes** (owner default 1). Retrieval practice
with corrective feedback is the strongest effect in
[the learning-science basis](../local-knowledge-vault-study-effects-on-learning.md) (Roediger & Karpicke 2006;
Butler & Roediger 2008), so a missed question should be studied as a question, straight away.

- **Import** (`practiceTest:import`, Study → **Import practice test**): the parsed items, a test name, the date taken
  and the project. The test is stored as **one** item of kind `practice-test`, titled "name · date", holding the
  questions, correct answers and explanations, never the learner's wrong answers. Re-importing the same test
  (project + name + date) reuses it.
- **Cards:** `origin = 'practice-test'`, `item_id` = the test item, `source_key = test:<hash(project,name,date)>#<n>`
  (unique, so a re-import adds nothing twice), `q_kind = 'test'`, `question` = the test's question with inline
  options removed (recall, not recognition), `answer` = the correct answer, `explanation` = the test's explanation.
  Wrong items are seeded as **Missed** (`last_grade = 'again'`, `lapses = 1`, due today, one `review_log` row with
  `migrated = 1` so session stats ignore it) and so come first in `buildReviewQueue`, outside the new-card budget.
  Correct items are added only with **Also add the ones I got right**, as new cards with priority −1.
- **Visual items** ("diagram", "figure", "exhibit", …) become open-the-source cards: the session asks the learner to
  recall or sketch, then **Open the test**. A performance-based question keeps its first line as the question and
  the steps as the explanation.
- **Answer sheets** with only letters ("Q3: B (correct: D)") need the question text; items without it are reported
  as "need question text" and get no card until the learner types it.
- **Link to the learner's note** (`study_cards.link_item_id`, v10): a project search for the question and answer
  (excluding practice tests, AI drafts, trashed and archived items) with at least two overlapping words and an answer
  word links the card to that note. Otherwise a deterministic corrective **AI draft** is written and linked. The
  session cites the linked note only once it is confirmed (status ≠ `ai-draft`); until then it says a draft is
  waiting (owner default 2: never block on confirmation). **Suggest fixes** stays optional; a saved suggestion is
  linked with `practiceTest:link`.
- **Study this project** skips `practice-test` items and pages that look like exam papers (three or more questions with
  `(1)`–`(3)` or `A.`–`C.` options), and still skips video transcripts; a single part can be added with **Add to
  review** (owner default 4). **Add to review** on a practice test reports it as already in Study.
- **Files:** `practiceTest:openFile` opens a PDF (text layer only), TXT or CSV in the main process and returns up to
  60,000 characters for the paste box.
- **Migration v10** adds the nullable columns `study_cards.explanation` and `study_cards.link_item_id`; nothing else
  changes.

### Two-way list cards (#273)

Lists are already sets of cards: acronyms, port tables, command lists and term definitions. Asking a model to write
questions about them is slow and can drift, so `electron/study-pairs.ts` extracts pairs with patterns and no model.

- **Extraction:** a Markdown table row becomes `first cell → the other cells`, labelled with the header row. A line
  `TERM - def`, `TERM: def`, `TERM = def` or `TERM — def` (bullets, numbering and bold allowed) is a pair when TERM
  is at most 5 words. Headings, URLs, frontmatter, import header lines and blank lines are ignored. Label words
  ("Example:", "Tip:", "Evidence:", "tricks:"…) are not terms.
- **List-like:** at least 60% of the content lines are pairs, and at least 3 pairs. On the evaluation notes this gives
  the acronym list 40/40, the ports table 15/15 rows, Windows commands 10 and cell structure 11. Evolution, homeostasis
  and the messy pasted page stay under the threshold.
- **Cards:** `origin = 'reverse'` (the existing CHECK value; the issue calls it `pairs`), `q_kind = 'pair'`,
  `chunk_index = NULL`, `quote` = the source line, `source_key = pair:<item>:<hash(term)>:f|r`. Forward: "What does
  AES stand for?" for acronyms, "Port 443 → ?" for table rows, "Nucleus → ?" otherwise. Reverse: "What is the acronym
  for Advanced Encryption Standard?", "HTTPS uses which port?", "Which term goes with Meaning “…”?", "Name the term:
  “…”". A reverse card is left out when its back is shared by another pair (two right answers) or when the
  definition gives the term away. Forward cards are inserted first and the queue breaks ties by row order, so a
  list's forward cards are studied before its reverse cards, inside the daily new-card budget.
- **Enrolling:** "Study this project" and "Add to review" make list cards for list-like notes (opt out with
  **Two-way cards for lists** on Study home; the choice is remembered on the device). A list-like note gets list
  cards *instead of* section cards, unless it has at least 30 words of prose outside the list, in which case it gets
  both. Running "Study this project" again adds list cards to list notes that were enrolled before #273, and leaves
  their section cards alone.
- **Edits:** the body-change hook re-extracts. An unchanged pair keeps its card and schedule; a pair whose definition
  changed keeps its schedule and gets the new question and answer; a removed line retires both its cards (history
  kept, and putting the line back revives them); new lines get cards while the note is still list-like. If every
  pair is gone and the note has no section cards, it gets section cards so it stays in Study.
- No schema change.

## Consequences

- One schedule per card: a 30-page book can be enrolled at page or chunk level and each part is graded on its own.
- Practice-test cards (#265) and reverse cards (#273) need no new tables: they are rows with a different `origin` and
  `source_key`. A practice-test card is usable at once with the test's own Q&A; its link to an AI draft is only
  cited after the user confirms the draft.
- Deleting a note deletes its cards, schedules and history (cascade). Trashing or archiving hides them from the
  queue.
- `review_schedule_legacy` stays in migrated vaults until a later release drops it.
