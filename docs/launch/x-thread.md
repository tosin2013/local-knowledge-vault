# X thread

8 posts. Character counts are raw counts (X counts any URL as 23 characters, so the last post is shorter on X; the 🧵 emoji counts as 2, so post 1 is 209 on X). Attach the demo video to post 2.

## 1/8 (208 chars)

I built Vault: a desktop app that lets you chat with your notes on your own computer.

Every answer cites the note it came from. If your notes don't cover the question, it says so.

Local models by default. 🧵

## 2/8 (117 chars)

> [attach docs/media/vault-demo.mp4 here (or the GIF)]

Here's the whole loop in 30 seconds: local model → ask → cited answer → open the source note → honest "I don't know".

## 3/8 (214 chars)

Local first:
• Auto-detects Ollama and LM Studio
• First run recommends qwen3:8b
• Notes live in SQLite on your machine
• Search works with no model and no network

With a local model, nothing leaves your computer.

## 4/8 (261 chars)

Citations are checked, not just requested.

Vault sends the model the matching notes with fixed rules, then drops any itm_ citation that wasn't in the retrieved set.

If search finds nothing, it says "I couldn't find that in your notes" without calling a model.

## 5/8 (251 chars)

> [optional image: docs/media/providers-add-dialog.png]

Prefer a cloud model? Add your own provider in a few clicks: OpenAI, Anthropic, Gemini, OpenRouter, Mistral, DeepSeek, Together, Groq, xAI, or any OpenAI-compatible URL.

Test connection before saving. A cloud provider is only called if you enable it.

## 6/8 (150 chars)

> [optional image: docs/media/providers-manage-plugins.png]

Plugins are a plugin.json folder or zip: provider presets, personas, prompt packs, MCP server presets.

They can't run code, so they're safe to share.

## 7/8 (226 chars)

Also in there:
• Media chat: YouTube or local captions become timed notes you can ask about
• Personas that change tone, not the grounding rules
• An MCP client (connect Notion)
• A local HTTP bridge + Obsidian plugin scaffold

## 8/8 (200 chars)

Next: Vault as an MCP server, so AI agents can use your notes as cited memory. Then signed Mac builds.

Mac, Windows, Linux. Code + feedback welcome: https://github.com/tosin2013/local-knowledge-vault
