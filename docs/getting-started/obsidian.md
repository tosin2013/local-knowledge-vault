# Obsidian and Markdown users

**Who this is for:** your notes already live in a folder of `.md` files, maybe an Obsidian
vault, and you want cited answers from them without changing how you write.

**In about 10 minutes you'll have:** your Markdown notes imported into Vault, a cited answer from
them, and, optionally, an **Ask Vault…** command inside Obsidian that inserts Vault's answer into
the note you're editing.

## 1. Install

Download Vault from the
[Releases page](https://github.com/tosin2013/local-knowledge-vault/releases) and open it. The
[README](../../README.md#download) has the macOS and Linux first-run notes.

## 2. Set up a model

Install [Ollama](https://ollama.com) and run `ollama pull qwen3:8b`, or load "Qwen3 8B" in
[LM Studio](https://lmstudio.ai). Vault detects either one, and the chip at the top shows
**Local · …** when it's ready. If you'd rather use a hosted model, see
[Quickest setup with a cloud model](cloud-quickstart.md).

## 3. Your first session

1. **Import your folder.** In the left column click **Import Markdown** and choose the folder (for
   Obsidian, the vault folder). Vault reads every `.md` file inside it, including subfolders. When
   it's done, a message says how many notes were imported and how many were skipped.
2. **See how your notes were filed.** Vault fills in each note like this:
   - **Title:** `title:` in the frontmatter, else the first `# Heading`, else the file name.
   - **Project:** `project:` in the frontmatter, else the first tag, else the first `#tag` in the
     text, else the subfolder it's in, else the folder name.
   - **Group, type and status:** `para:`, `kind:` and `status:` in the frontmatter if you use them.
     Otherwise the note goes in Resources as an active note.
   - **Links:** `[[wiki links]]` become plain text, so they search cleanly.
3. **Ask.** Type a question in the box at the bottom, using words you'd find in your notes, and
   press Enter. To stay inside one project, click **Customize** and pick it under **Project**.
4. **Open the source.** Click a citation number like **[1]** or its chip. The note opens beside the
   chat.

### Optional: ask Vault from inside Obsidian

Vault runs a small local server, the **Vault Bridge**, at `http://127.0.0.1:8765` while the app is
open. A scaffold Obsidian plugin in this repository uses it.

1. In Vault, click the gear (**Settings**) at the top right. The **AI providers** window opens.
   Scroll to **Vault Bridge**: it should say **Listening on http://127.0.0.1:8765**. Copy the
   **Bearer token**. Treat it like a password.
2. Copy the files from [`bridges/obsidian-vault/`](../../bridges/obsidian-vault/) into your
   Obsidian vault at `.obsidian/plugins/vault-bridge/`. It ships a ready-built `main.js`.
3. In Obsidian, open **Settings → Community plugins** and turn on **Vault Bridge**.
4. In the plugin's settings, paste the token into **Bridge token**. **Bridge base URL** is already
   `http://127.0.0.1:8765`. **Default project** is optional.
5. Run **Ask Vault…** from Obsidian's command palette. Vault's answer and the list of notes it
   cited are inserted into your current note. **Vault health** checks that the bridge is up.

The [bridge docs](../bridges.md) and the [plugin README](../../bridges/obsidian-vault/README.md)
have more, including `curl` examples for scripts.

## 4. What to expect

- **Answers cite your imported notes** with numbered citations and source chips.
- **Honest gaps:** "I couldn't find that in your notes" when nothing matches. When the matches
  don't answer the question, the model says so instead of guessing.
- A **No notes cited** chip appears only when an answer has substance but cites nothing.

## 5. Tips and limits

- **Importing is a one-time copy, not a sync.** Vault keeps its own copy of the notes in a local
  database. Editing a file in Obsidian later doesn't change Vault, and importing the same folder
  again adds the notes a second time. Re-import a subfolder of new notes instead.
- **Skipped:** hidden files and folders, `.obsidian`, `.trash`, `.git`, `node_modules`, empty files
  and files over 2 MB. Only `.md` text is read, not images or attachments.
- **The bridge answers from Vault's notes,** so import the notes you want it to know about first.
- **The bridge is local only.** It listens on `127.0.0.1` and every call except `/health` needs
  the token. Don't expose or port-forward it. **Regenerate** in **Vault Bridge** issues a new
  token if you think it leaked. If another program already uses port 8765, **Vault Bridge** says
  so; set the `LKV_BRIDGE_PORT` environment variable before starting Vault to use another port.
- **Search is keyword-based,** so short notes and questions that reuse your own words work best.
- The Obsidian plugin is a scaffold: it isn't in Obsidian's community plugin directory yet, so
  install it by copying the files as above.

## Next steps

- [Local AI and privacy](local-and-private.md): make sure nothing leaves your computer.
- [Readers and note-takers](readers.md): add web articles and books alongside your Markdown.
