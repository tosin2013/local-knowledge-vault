# r/ObsidianMD

Check the subreddit's rules on self-promotion and non-Obsidian tools first. Frame it as a companion,
not a replacement.

## Title

I built a local "ask my notes" app with strict citations, plus a small Obsidian plugin that calls it (my project, works alongside Obsidian)

## Body

Disclosure: this is my own project. I'm not trying to pull anyone away from Obsidian. Obsidian is
great at linked thinking and I'm not rebuilding that. Vault is a narrower tool: ask a question and
get an answer that cites the exact note it came from, or an honest "I don't know."

**How it fits with Obsidian:**

- While Vault is running, it serves a small HTTP API on `127.0.0.1:8765` (loopback only).
- The repo includes an Obsidian plugin scaffold (`bridges/obsidian-vault/`) with two commands:
  **Vault health** and **Ask Vault…**, which inserts the answer and its citations into your
  active note.
- Install it by copying the folder into `.obsidian/plugins/vault-bridge/` and enabling it under
  Community plugins. It's a scaffold, not a listed community plugin.
- Being upfront about the limit: it does **not** sync your Obsidian notes into Vault yet. Vault
  answers from the notes stored in Vault (created in the app, imported from a URL, or from video
  captions).

**About Vault itself:**

- Notes stored locally in SQLite; local models by default (Ollama or LM Studio, auto-detected;
  `qwen3:8b` recommended), cloud providers only if you enable them.
- Citations are checked: any cited note ID that wasn't retrieved gets dropped.
- Keyword search (SQLite FTS5), no embeddings yet.
- Media chat turns YouTube or local captions into timed notes you can ask about.

Repo: https://github.com/tosin2013/local-knowledge-vault

Question for this sub: would syncing a chosen Obsidian folder into Vault (read-only) be useful to
you, or would you rather Vault read your Markdown files directly?
