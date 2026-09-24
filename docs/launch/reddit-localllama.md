# r/LocalLLaMA

Check the subreddit's current self-promotion rules before posting. Post as a text post with the GIF
or MP4 attached (or linked), and stay in the comments for the first few hours.

## Title

I built Vault: a local-first notes app where Ollama/LM Studio answers only from your notes, with citations (or says it doesn't know)

## Body

Disclosure up front: this is my own project. I'm posting it here because it's built around local
models first, and I'd like feedback from people who run them daily.

**What it is:** a desktop app (Electron; macOS, Windows, Linux) that stores your notes in SQLite
and lets you ask questions about them. Every answer has to cite the note it came from (`itm_`
IDs shown as clickable badges that open the source note). If your notes don't cover the question,
it's supposed to say so.

**The local part:**

- Auto-detects **Ollama** (`127.0.0.1:11434`) and **LM Studio** (`127.0.0.1:1234/v1`). No setup
  beyond having one of them running.
- Picks an installed Ollama model automatically: skips embedding models, prefers 3B+ params, and
  prefers qwen3 → llama3.2 → llama3 → gemma3 → mistral. `LKV_OLLAMA_MODEL` forces one.
- The first-run card recommends **`qwen3:8b`** (~5 GB). It's been the most reliable 7–8B model I've
  tried for "answer only from these passages and cite them"; `llama3.1:8b` is the alternative.
- If you run something tiny (<3B), it shows a hint that bigger models follow the citation rules
  more reliably.
- `<think>` blocks from reasoning models are stripped from the answer.
- Any OpenAI-compatible local server works too (llama.cpp server, vLLM, LocalAI, Jan).

**Grounding:** retrieval is SQLite FTS5 keyword search (BM25). No embeddings yet, which I know is
the first question here. The model gets the numbered passages plus fixed rules, and after
generation any cited ID that wasn't in the retrieved set is dropped. If search returns nothing,
Vault answers "I couldn't find that in your notes" without calling the model at all.

**Cloud is opt-in:** you can add OpenAI, Anthropic, Gemini, OpenRouter, Groq, etc., but a cloud
provider is never called unless you enable it.

**Plugins** are `plugin.json` packs (provider presets, personas, prompt packs, MCP presets) that
can't execute code.

Repo: https://github.com/tosin2013/local-knowledge-vault

Things I'd really like input on:

1. Which small models follow citation rules best in your experience?
2. Is keyword-only retrieval a dealbreaker, or is it fine for personal notes?
3. What would you want from "Vault as an MCP server" (next on my list)?
