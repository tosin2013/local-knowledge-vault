# Product Hunt

Launch a few days after Show HN and Reddit, once installers are on the Releases page (Product Hunt
visitors expect a download). Gallery: the demo GIF/MP4 first, then
`docs/media/vault-ask-citation.png`, `providers-first-run.png`, `providers-add-dialog.png`,
`providers-manage-plugins.png`, and `social-preview.png` as the thumbnail source.

## Name

Vault

## Tagline (58 / 60 chars)

Chat with your notes locally. Every answer cites a source.

## Description (225 / 260 chars)

Vault is a desktop app for asking questions about your notes. It runs on local models (Ollama or LM Studio) by default, cites the note behind every answer, and says when it doesn't know. Notes stay in SQLite on your computer.

## Topics

Pick the closest matches in Product Hunt's topic picker (names there change over time):

- Productivity
- Artificial Intelligence
- Notes
- Mac
- Open Source (only once a license is added and the repo is public)

## Maker's first comment

Hi Product Hunt, I'm Tosin, and I built Vault.

I wanted a "chat with my notes" tool I could actually trust. Most tools give a fluent answer
without showing where it came from. Vault works the other way around:

- **Every answer cites the note it came from.** Click a citation badge and the source note opens
  beside the chat. Citations the model invents are dropped.
- **It says "I don't know."** If your notes don't cover a question, Vault tells you instead of
  guessing.
- **Local by default.** It detects Ollama or LM Studio automatically and recommends `qwen3:8b`
  on first run. With a local model, nothing leaves your computer. Your notes are stored in SQLite
  on your machine either way.
- **Bring any model.** Add OpenAI, Anthropic, Gemini, OpenRouter, Mistral, DeepSeek, Together,
  Groq, xAI or any OpenAI-compatible server, and test the connection before saving.
- **Plugins you can share safely.** A plugin is a `plugin.json` pack of provider presets,
  personas, prompts and MCP presets. Plugins can't run code.

There's also Media chat (YouTube or local captions become timed notes you can ask about), an MCP
client that connects to Notion, and a local bridge for Obsidian.

It's early: search is keyword-based (no embeddings yet), it's single-user, and the Mac build isn't
signed yet. Next up is running Vault as an MCP server so AI agents can use your notes as cited
memory.

I'd love to hear what you'd use it for, and what's missing.
