# Students and exam prep

**Who this is for:** you're learning from textbooks, course PDFs or your own notes, maybe with an
exam date coming up, and you want practice rather than just re-reading.

**In about 10 minutes you'll have:** a book in Vault, a cited answer about it, your first
recall-first **Study** attempt, a few notes on a **Review** schedule, and a way to turn a practice
test's wrong answers into notes.

## 1. Install

Download Vault for your computer from the
[Releases page](https://github.com/tosin2013/local-knowledge-vault/releases) and open it. The
[README](../../README.md#download) covers the macOS "can't verify the app" message and the Linux
packages.

## 2. Set up a model

Vault needs an AI model to write answers. Search works without one.

- **Free and private (recommended):** install [Ollama](https://ollama.com), then run
  `ollama pull qwen3:8b` in a terminal. It's about 5 GB. Open Vault and the chip at the top should
  read **Local · Ollama · qwen3:8b**. If it doesn't, Vault shows a card titled **Vault runs on
  local models** with the same command and a **Re-check** button.
- **Older or low-memory laptop:** click **Use a cloud model instead** on that card and follow
  [Quickest setup with a cloud model](cloud-quickstart.md). Your questions and the matching note
  passages then go to that provider.

Very small models (under about 3B parameters) follow the "cite your notes" rules less reliably.
Vault shows a hint if it detects one.

## 3. Your first session

1. **Bring in a book.** In the left column click **Import book / PDF** and pick an `.epub` or
   `.pdf`. Vault makes one note per chapter (EPUB) or per few pages (PDF), all in a project named
   after the book. Covers and Project Gutenberg licence pages are skipped.
2. **Ask about it.** Make sure the toggle at the top says **Ask**. Click **Customize**, set
   **Project** to the book, and type a question in the box at the bottom, for example
   `What are the main causes of …?` Press Enter.
3. **Check the answer.** Each point ends with a number like **[1]**. The chips under the answer
   list the chapters it used. Click one to read that chapter beside your chat.
4. **Test yourself first.** Click **Study** in the toggle at the top (**Ask · Find · Study**), then
   the **Quiz me on…** tab.
   - Type a **Question** and click **Get answer from my notes**. Vault fetches the answer but
     keeps it hidden.
   - Write what you remember in **Your recall**, or click **I don't know**.
   - Move the **How confident are you?** slider, then click **Reveal answer**.
   - Under **How did you do?** pick **Missed**, **Partial** or **Got it**. Optionally fill in
     **Explain it in your own words**, then click **Save attempt**.

   Once you've saved attempts, a calibration line at the top compares how sure you felt with how
   you actually did.
5. **Run a study session.** In **Study**, pick your project on **Home** and click **Study this project**
   (or open the **Study session** tab and, under **Add notes to Study**, search for a topic and click
   **Add to review**; a note that already has cards says **Already in Study**). Optionally set the
   project's exam date. Click **Start session**: each card asks one question written from a section of
   your note. Type your answer from memory (or click **I don't know**), set **How sure are you?**, then
   click **Reveal answer** to see the answer, the quote from your note and a link to it. Grade yourself
   **Missed**, **Partly** or **Got it**; missed cards come back at the end of the session. The summary
   shows your accuracy, how your confidence matched it, the cards you were sure of but missed, the notes
   to revisit and when the next cards are due. Click **Ask** in the toggle to return.
6. **Learn from a practice test.** In **Study**, open the **Import practice test** tab and paste your results into
   **Paste practice-test results**. Plain text works:

   ```text
   1. What is the capital of France? ✓
   Your answer: Paris

   2. What is 2 + 2? ✗
   Your answer: 5
   ```

   CSV with `question,answer,correct` columns works too. Vault splits the items into **Correct**
   and **Incorrect**. Click **Suggest fixes** to get a short corrective note for each wrong answer,
   based on your notes, then **Save as draft note** for the ones you want. For correct items,
   **Save flash-card** keeps the question as a note.

## 4. What to expect

- **Cited answers** you can check against the chapter they came from.
- **Honest gaps:** if the book doesn't cover your question, Vault says "I couldn't find that in
  your notes" or that the notes don't cover it. That's the right answer, not an error.
- **AI drafts stay drafts.** Notes written by the model (from **Test to notes** or **Save as
  note**) carry an **AI draft** label and rank below your own notes. Open one, click **Edit**, and
  either change it and **Save**, or write one line in **In your own words** and click
  **Confirm draft**. Putting it in your own words is part of the learning.

## 5. Tips and limits

- **Use the book's words.** Search is keyword-based, not meaning-based, so questions that reuse
  terms from the text find the right chapters.
- **Study and Review look at all your notes.** With several books loaded, include a word from the
  one you mean.
- **Scanned PDFs don't work yet.** Vault reads the PDF's text layer. Pages without one (photos of
  pages) are skipped, with no OCR.
- **Long chapters:** only the start of each matching note (about 1,200 characters) goes to the
  model, so very long chapters can give partial answers. Ask narrower questions.
- **A study-style personality:** in **Customize → Personality**, **Socratic coach** asks a
  clarifying question before answering. With **Advanced** switched on, the **Personalities** button
  lets you make your own from the **Study guide** template, which turns notes into Q&A.
- Whether Study mode and spaced review help *you* learn is still a hypothesis. The
  [learning and retention study](../local-knowledge-vault-study-effects-on-learning.md) explains
  the research behind them and how it will be measured.

## Next steps

- [Readers and note-takers](readers.md): add articles with **Add from URL** and write your own
  notes.
- [Learning from video](video.md): turn lecture recordings or YouTube videos into notes you can
  ask about.
- [PLUGINS.md](../../PLUGINS.md#study-tab-not-an-add-on): more detail on the Study tab's three
  sections.
