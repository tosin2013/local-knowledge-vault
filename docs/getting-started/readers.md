# Readers and note-takers

**Who this is for:** you read books and articles, keep notes, and want to ask questions across
all of it, with every answer showing where it came from.

**In about 10 minutes you'll have:** a book, a web article and a note of your own in Vault, a
cited answer that pulls from them, and the habit of clicking a citation to check it.

## 1. Install

Download Vault from the
[Releases page](https://github.com/tosin2013/local-knowledge-vault/releases) and open it. The
[README](../../README.md#download) has the macOS and Linux first-run notes.

## 2. Set up a model

- **Local (recommended):** install [Ollama](https://ollama.com) and run `ollama pull qwen3:8b`
  (about 5 GB), or install [LM Studio](https://lmstudio.ai) and load "Qwen3 8B". Vault finds it
  on its own: the chip at the top reads **Local · Ollama · qwen3:8b** (or **Local · LM Studio · …**).
- **No local model?** Use [Quickest setup with a cloud model](cloud-quickstart.md).

## 3. Your first session

1. **Try the built-in guide.** First launch adds a **Vault guide** project. Type
   `How do citations work?` in the box at the bottom and press Enter. You'll get an answer with
   **[1]**-style citations pointing at guide notes.
2. **Import a book.** Click **Import book / PDF** in the left column and pick an `.epub` or a
   text-based `.pdf`. Each chapter (or group of pages) becomes a note, in a project named after
   the book.
3. **Save an article.** Under **Add from URL**, paste a full `https://…` link to a public page
   and click **Import**. Vault saves the page text as a note and tags it with a group and type.
4. **Write a note.** Click **New note**. Give it a title, type in the body, and click **Save**.
   The **Project** box lets you pick an existing project or type a new name.
5. **Ask across everything.** Ask a question that touches what you just added. Leave the project
   on **All** to search everything, or click **Customize** and pick a **Project** to stay inside
   one book.
6. **Check a claim.** Click a number like **[2]**, or the matching chip under the answer. The note
   opens beside the chat, so you don't lose your place.
7. **Keep a good answer.** Click **Save as note** under it. It opens as a new note marked
   **AI draft**. Click **Save** to keep it. To make it count as yours, open it later, click
   **Edit**, and either change it and **Save**, or write one line **In your own words** and click
   **Confirm draft**.

## 4. What to expect

- **Numbered citations** for each claim, with matching source chips. Citations to notes that
  weren't part of the search are removed before you see the answer.
- **"I couldn't find that in your notes"** when nothing matches, or a plain "the notes don't
  cover this" when the matching notes don't answer the question. Neither is flagged as a problem.
- **No notes cited:** if the model writes an answer with substance but cites nothing, Vault adds
  a small **No notes cited** chip so you know to double-check it.

## 5. Tips and limits

- **Short notes, familiar words.** Search matches words, not meaning. Questions that reuse words
  from your notes work best, and short focused notes beat one huge note.
- **Change the answer style:** **Customize → Personality** offers **Concise bullets** and
  **Socratic coach**. A personality changes tone and format only. The rules about citing your
  notes always apply.
- **Organise as you go:** each note has a **Group** (Projects, Areas, Resources, Archive), a
  **Type** and a **Status**. The project filter at the top of the notes list and the gear next to
  it (**Manage projects**) help once you have a lot of notes.
- **Share your sources:** **Export citation pack** in the chat list saves the chat, the notes it
  cited and a manifest as a folder or zip.
- **Deleted by mistake?** Deleted notes go to **Trash** first, where you can restore them.
- **Add from URL** only fetches public pages. If you use a cloud model, it also receives an
  excerpt of the page to suggest tags.

## Next steps

- [Students and exam prep](students.md): recall practice and spaced review over the same notes.
- [Obsidian and Markdown users](obsidian.md): import a whole folder of notes at once.
- [docs/personalities.md](../personalities.md): write your own answer style.
