# Local AI and privacy

**Who this is for:** you want your notes and questions to stay on your computer, you already run
(or want to run) local models with Ollama or LM Studio, and you'd like to know exactly what Vault
sends over the network.

**In about 10 minutes you'll have:** Vault answering from a local model, set to never fall back to
a cloud service, with the update check turned off if you want, and a clear picture of where your
data lives.

## 1. Install

Download Vault from the
[Releases page](https://github.com/tosin2013/local-knowledge-vault/releases). On Linux there are
`.AppImage`, `.deb`, `.rpm` and `.snap` packages. The [README](../../README.md#download) has the
macOS and Linux first-run notes. If you'd rather build it yourself, see
[Build from source](../../README.md#build-from-source) (needs Node.js 22).

## 2. Set up a local model

Vault looks for local models in this order, without any setup:

1. **Ollama** at `http://127.0.0.1:11434`. Install [Ollama](https://ollama.com) and run
   `ollama pull qwen3:8b` (about 5 GB). Vault picks a suitable installed model on its own, skipping
   embedding models. `llama3.1:8b` also works.
2. **LM Studio** at `http://127.0.0.1:1234/v1`. In [LM Studio](https://lmstudio.ai), load
   "Qwen3 8B" and start its local server. Vault uses whichever model is loaded.
3. **Any other local server you add** that speaks the OpenAI API (llama.cpp server, vLLM,
   LocalAI, Jan…). Add it from **AI providers → Add provider → Custom (OpenAI-compatible)** with a
   `localhost` or LAN address.

When it works, the chip at the top reads **Local · Ollama · qwen3:8b** (or similar). If nothing
is found, Ask shows the **Vault runs on local models** card with the pull command, **Re-check**,
and links to **Get Ollama** and **Get LM Studio**. Models under about 3B parameters follow the
citation rules less reliably, and Vault shows a hint if it detects one.

Different address or model? Set `LKV_OLLAMA_URL`, `LKV_OLLAMA_MODEL` or `LKV_LMSTUDIO_URL`
before starting Vault. See [docs/providers.md](../providers.md).

## 3. Your first session

1. **Lock it to local.** Switch on **Advanced** (top right), then click the AI chip at the top to
   open **AI providers**. Set **Use** to **Auto — local only (never cloud)**. The window confirms:
   "Local only: cloud providers are never used, even if they are enabled." The list is split into
   **Local — nothing leaves this computer** and **Cloud — used only when enabled**.
2. **Decide on the update check.** In the same window, under **Updates**, switch off **Check for
   updates when Vault starts** if you don't want Vault to contact GitHub at launch.
3. **Ask a question.** Close the window, switch **Advanced** off again if you like, and ask
   something about the built-in **Vault guide** notes, such as `What is PARA?`. Answers from a
   local model have no cloud badge. Any answer written by a cloud provider shows a
   **Cloud · …** or **Cloud fallback · …** chip.
4. **Add your own notes** with **New note**, **Import Markdown**, **Import book / PDF** or
   **Add from URL**. The first three read files from your computer only.

## 4. What leaves your computer

- **With a local model: none of your notes or questions.** Health checks only contact local
  servers.
- **Update check:** installed builds make one request to GitHub at launch to see whether a newer
  version exists. It sends nothing about you or your notes and downloads nothing. Turn it off
  under **AI providers → Updates** (the gear button opens the same window).
- **Add from URL** fetches the page you give it.
- **Media chat** contacts YouTube (through `yt-dlp` and the embedded player) only when you use a
  YouTube link. Local video files and captions stay local.
- **Notion** is contacted only if you connect it under **Plugins → MCP connections**.
- **Cloud providers** are only used if you enable one and you're not on **Auto — local only**.
  Then your question, the matching note passages and recent chat turns go to that provider.
  **Test connection** and **Fetch models** also contact the provider you're editing.
- **Vault Bridge** listens on `127.0.0.1` only, for tools on your own computer, and needs a token.

## 5. Where your data lives

| System | Folder |
|---|---|
| macOS | `~/Library/Application Support/local-knowledge-vault` |
| Windows | `%APPDATA%\local-knowledge-vault` |
| Linux | `~/.config/local-knowledge-vault` |

- The notes are in `lkv.sqlite`, a regular SQLite file. **It isn't encrypted**, so protect it the
  way you protect other files, for example with full-disk encryption.
- API keys and the bridge token are encrypted with your system keychain where one is available.
  On Linux without a keyring they're saved as files only your user account can read, and
  **AI providers** shows a notice saying so.
- Back up by copying the folder while Vault is closed. Set `LKV_USER_DATA_DIR` to keep a separate,
  throwaway profile.

## 6. Tips and limits

- **Search works with no model and no network.** Switch the toggle from **Ask** to **Find**.
- **Pick a bigger model if you can.** 7–8B models such as `qwen3:8b` follow "answer only from these
  notes and cite them" much better than tiny ones.
- **Expect honest gaps:** "I couldn't find that in your notes", or a plain "the notes don't cover
  this", is the correct answer when they don't.
- With **Auto — local only** and no local model running, Ask says so and you can still search.

## Next steps

- [Obsidian and Markdown users](obsidian.md): import a notes folder and use the local bridge.
- [docs/providers.md](../providers.md): every provider setting and environment variable.
- [README → Privacy](../../README.md#privacy).
