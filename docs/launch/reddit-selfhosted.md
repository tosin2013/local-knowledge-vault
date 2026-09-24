# r/selfhosted

Check the subreddit's self-promotion rules (and any weekly thread requirement) before posting.

## Title

Vault: a local-first desktop notes app with cited AI answers. Data stays in SQLite on your machine, local models by default (my project)

## Body

Full disclosure: I built this. It's a desktop app rather than a server, but it's built on the same
idea this sub cares about: your data stays on hardware you control.

**What it does:** you keep notes in Vault and ask questions about them. Answers cite the note they
came from (click a citation to open the source note), and when your notes don't cover something,
it says so.

**Where your data lives:**

| OS | Folder |
|---|---|
| macOS | `~/Library/Application Support/local-knowledge-vault` |
| Windows | `%APPDATA%\local-knowledge-vault` |
| Linux | `~/.config/local-knowledge-vault` |

That folder holds the SQLite database (`lkv.sqlite`), provider settings, API keys (owner-only
files) and plugins. `LKV_USER_DATA_DIR` moves it anywhere you like.

**What leaves the machine:**

- With a local model (Ollama or LM Studio, auto-detected): nothing.
- With a cloud provider you explicitly enabled: the question, the matching note passages and
  recent chat turns, to that provider only.
- Notion only if you connect it through the built-in MCP client.
- Health checks only ping local servers.

**Self-hoster-friendly bits:**

- Point it at any OpenAI-compatible endpoint (vLLM, llama.cpp server, LocalAI, a gateway) over
  http or https, including one on your LAN.
- A loopback HTTP API on `127.0.0.1:8765` (`/health`, `/v1/projects`, `/v1/ask`) for scripts
  and the Obsidian plugin scaffold. It has no auth yet, so keep it on loopback.
- Search works with no model and no network.
- Declarative plugins (`plugin.json`), no code execution.

**Limits:** single user, no sync, keyword search (no embeddings), unsigned macOS builds for now.

Repo: https://github.com/tosin2013/local-knowledge-vault

Feedback welcome, especially on what you'd want before running it as your main notes store
(backups? export format? a headless mode?).
