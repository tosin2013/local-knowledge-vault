# LinkedIn post

Attach the demo MP4 natively (LinkedIn autoplays uploaded video; links to GitHub get less reach, so
put the repo link in the first comment).

---

I just released Vault, a desktop app for chatting with your own notes.

The idea is simple. An AI answer about your notes is only useful if you can check it. So in Vault:

→ Every answer cites the note it came from. One click opens the source.
→ Citations the model makes up are dropped before you see them.
→ When your notes don't cover the question, it says "I don't know."

It runs on local models by default. It detects Ollama or LM Studio on your machine, and your notes
are stored in a local SQLite database. If you'd rather use a cloud model, you can add OpenAI,
Anthropic, Gemini, OpenRouter, Groq and others in a couple of clicks, and they're only used when
you turn them on.

A few things I learned building it:

1. Grounding is a product decision, not just a prompt. Checking citations after generation
   mattered more than any prompt wording.
2. "I don't know" is a feature. It's the answer that makes the other answers believable.
3. Local-first changes the defaults. Search works with no model and no network, and that's the
   starting point, not the fallback.

As a builder I spend a lot of time helping teams make decisions from the knowledge they already
have. Vault is my personal take on that problem, starting with one person and their notes.

Next up: letting AI agents use Vault as cited memory over MCP.

If you try it, I'd like to hear where it breaks. Link in the first comment.

#LocalFirst #AI #LLM #Ollama #OpenSource #BuildInPublic

---

**First comment:** Repo and installers: https://github.com/tosin2013/local-knowledge-vault

(The repo is public under Apache-2.0, so `#OpenSource` applies.)
