# Show HN

Post from the account you'll monitor all day. Link: `https://github.com/tosin2013/local-knowledge-vault`
(the repo must be public and a release published first; see [launch-checklist.md](./launch-checklist.md)).

## Title options

1. Show HN: Vault – Chat with your notes locally; every answer cites its source
2. Show HN: Vault – Local notes AI that cites its source or says "I don't know"
3. Show HN: Vault – Local LLM Q&A over your notes, with note-level citations

## Body

Vault is a desktop app (Electron, macOS/Windows/Linux) for asking questions about your own notes.
Every answer has to cite the note it came from, and when your notes don't cover something, it says
so instead of guessing.

How it works:

- Notes live in a local SQLite database. Search is SQLite FTS5 (BM25), so it works with no model
  and no network.
- Ask retrieves matching notes, sends the passages to the model with fixed grounding rules, and
  checks the answer: any `itm_` citation that wasn't in the retrieved set is dropped. If search
  finds nothing, Vault says so without calling a model.
- Local models by default: it auto-detects Ollama or LM Studio. The first-run card recommends
  `qwen3:8b`.
- You can add a cloud provider if you want (OpenAI, Anthropic, Gemini, OpenRouter, Mistral,
  DeepSeek, Together, Groq, xAI or any OpenAI-compatible URL), with a Test connection button.
  Cloud providers are only called when you enable them.
- Plugins are declarative `plugin.json` packs (provider presets, personas, prompt packs, MCP
  server presets). They can't run code, so they're safe to share as a zip.

Also in there: Media chat (YouTube or local captions become timed notes you can ask about),
reusable personas that change tone but not the grounding rules, an MCP client that can connect to
Notion's hosted MCP server, a loopback HTTP bridge with an Obsidian plugin scaffold, and citation
pack export.

Limits, honestly: retrieval is keyword search with no embeddings, it's single-user, and macOS builds
aren't signed yet.

I'd love feedback on the grounding approach and on which local models follow the citation rules
best for you.

## First comment (post right after submitting)

Hi HN, I'm Tosin, and I built this.

Motivation: I kept getting confident answers from "chat with your notes" tools that I couldn't
check. I wanted the opposite default: an answer is only useful if I can click through to the note
it came from, and "I don't know" is a valid answer.

Stack: Electron 44, React 19, Vite, TypeScript, MUI, better-sqlite3 with FTS5, and the official MCP
TypeScript SDK. Installers are built with electron-builder.

Local-first design choices:

- The notes database, settings, API keys (owner-only files) and plugins all live in the app's
  user-data folder.
- Auto mode tries Ollama, then LM Studio, then other local servers, and only then cloud providers
  you've enabled and given a key. Health checks ping local servers only.
- With a cloud provider, only the question, the matching passages and recent chat turns are sent.
- I chose keyword search over embeddings for v0: it's predictable, fast and needs no extra model.
  The trade-off is that it misses paraphrases, so short focused notes work best.
- Plugins are data, not code, on purpose. Code plugins may come later behind a permission model.

What's next:

- Vault as an MCP server, so AI agents can use your notes as cited memory
- Signed and notarized macOS builds
- A starter sample vault for a better first run

Happy to answer anything about the grounding prompt, the citation check, or local model choices.
