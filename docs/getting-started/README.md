# Getting started with Vault

Vault is a desktop app that answers questions from your own notes. Every answer points to the
notes it used, shown as numbered citations like **[1]**. When your notes don't cover a question,
Vault tells you so instead of guessing.

Pick the guide that sounds most like you. Each one takes about 10 minutes and ends with a working
first session. You can read more than one: they share the same app, they just start in different
places.

| You are… | You want to… | Guide |
|---|---|---|
| A student or studying for an exam | Turn textbooks and notes into practice: recall, spaced review, fix wrong answers | [Students and exam prep](students.md) |
| A reader or note-taker | Ask questions about books, articles and your own notes | [Readers and note-takers](readers.md) |
| An Obsidian or Markdown user | Bring a folder of `.md` notes in, and ask Vault from inside Obsidian | [Obsidian and Markdown users](obsidian.md) |
| Privacy-minded, or you run local AI models | Keep everything on your computer and know exactly what leaves it | [Local AI and privacy](local-and-private.md) |
| Learning from videos, talks or podcasts | Ask questions about a YouTube video or a local recording and jump to the moment | [Learning from video](video.md) |
| In a hurry, happy to use a cloud AI service | Get answers working with an API key in a few clicks | [Quickest setup with a cloud model](cloud-quickstart.md) |

## The same in every guide

- **Install:** download the installer for your computer from the
  [Releases page](https://github.com/tosin2013/local-knowledge-vault/releases). The main
  [README](../../README.md#download) has the macOS and Linux first-run notes.
- **The screen:** the left side is your notes. The middle is **Ask**: you type a question at the
  bottom and the answer appears above it. The right side lists your chats. The chip at the top
  shows which AI model is answering, for example **Local · Ollama · qwen3:8b**.
- **Answers:** each claim ends in a number such as **[1]**, and the matching source chips sit under
  the answer. Click either to open the note beside your chat.
- **No answer is a real answer:** if your notes don't cover the question, you'll see
  "I couldn't find that in your notes" or a plain statement that the notes don't cover it.
- **Search works without AI:** switch the toggle at the top from **Ask** to **Find** to search your
  notes by keyword, even with no model and no internet.
- **First launch** adds a small **Vault guide** project: real notes that explain the app. Ask it
  something like "What is PARA?" to see a cited answer. Remove it later with **Remove guide** in
  the left column.

Building Vault yourself instead of using an installer? See
[Build from source](../../README.md#build-from-source) (needs Node.js 22).
