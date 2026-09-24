# AI providers (local-first registry)

Vault answers from **your notes only**, with citations. The model that writes the answer is
pluggable. Local models come first. Cloud models are used only when you enable them.

## How Vault picks a model

The **Use** setting (Advanced → AI providers, or click the AI chip in the header):

- **Auto (local first):** the default for new installs. Vault tries, in order:
  1. **Ollama** at `http://127.0.0.1:11434` (or `LKV_OLLAMA_URL`). The model is auto-picked from
     what's installed. Embedding models are skipped, models of 3B+ params are preferred, and
     qwen3 → llama3.2 → llama3 → gemma3 → mistral are preferred in that order.
     `LKV_OLLAMA_MODEL` forces one model.
  2. **LM Studio** at `http://127.0.0.1:1234/v1` (or `LKV_LMSTUDIO_URL`), using whichever model
     it has loaded.
  3. Any other **local** provider you added (a localhost/LAN OpenAI-compatible server).
  4. **Enabled cloud providers** that have a key, in list order. A disabled cloud provider is never called.

  If one candidate fails mid-request, Vault falls through to the next.
- **A specific provider ("Groq only", …):** uses only that provider, with no fallback. That keeps
  an explicit cloud choice predictable, and it's what a migrated Groq setup uses (see below).

If nothing local is running and no cloud provider is enabled, Ask shows the **first-run card**:

- It suggests starting Ollama or LM Studio and recommends **`ollama pull qwen3:8b`**. Qwen3 8B is
  about 5 GB and currently the best 7–8B instruction follower for "answer only from these
  passages and cite them". `llama3.1:8b` is a good alternative.
- It has **Re-check** and a visible **Use a cloud model instead** button.
- Search always works, even with no model at all.

If the model in use looks tiny (<3B params, judged from the name or Ollama's `parameter_size`),
Vault shows a gentle hint that bigger models follow the citation rules more reliably.

## Built-in presets

| Preset | Base URL | Default model | Key |
|---|---|---|---|
| Ollama (local) | `http://127.0.0.1:11434` | auto-pick installed | none |
| LM Studio (local) | `http://127.0.0.1:1234/v1` | loaded model | none |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | required |
| Anthropic | `https://api.anthropic.com/v1` | `claude-haiku-4-5` | required |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.8-flash` | required |
| OpenRouter | `https://openrouter.ai/api/v1` | `openrouter/auto` (`openrouter/free` for free models) | required |
| Mistral | `https://api.mistral.ai/v1` | `mistral-small-latest` | required |
| DeepSeek | `https://api.deepseek.com` | `deepseek-flash` | required |
| Together | `https://api.together.ai/v1` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | required |
| Groq | `https://api.groq.com/openai/v1` | `openai/gpt-oss-20b` | required |
| xAI | `https://api.x.ai/v1` | `grok-4.3` | required |
| Custom | any OpenAI-compatible URL (vLLM, llama.cpp server, LocalAI, Jan, gateways) | you choose | optional |

Transports:

- `openai-compatible` (`/chat/completions`, `/models`) covers most providers.
- `anthropic` is the Messages API: `x-api-key` + `anthropic-version: 2023-06-01`, top-level
  `system`, and no temperature.
- `ollama` is `/api/generate` and `/api/tags`.
- Gemini goes through Google's official OpenAI-compatible endpoint.

Model defaults change often. Use **Fetch models** in the dialog to pick from the provider's live list.

## Add your own provider

Go to Advanced → AI providers → **Add provider**:

1. Pick a preset, or **Custom (OpenAI-compatible)** and then the API style.
2. Set the name, base URL, API key (masked, and optional for local servers) and model. **Fetch
   models** lists what the server offers.
3. **Test connection** sends `Reply with exactly: OK` and shows the latency or the exact error
   (for example `HTTP 401: Invalid API key`).
4. Click **Save**. The provider appears in the list with an enable switch. Local servers go in the local section.

## Where keys live

- Keys are **write-only** in the UI. The renderer only ever sees `hasKey` / `keySource`.
- Keys you save are stored in `<userData>/lkv-keys/<provider-id>.key`. The directory is `0700`
  and the file is `0600`.
- Env vars win over files: `LKV_<PRESET>_API_KEY` or the provider's usual name (`OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`,
  `DEEPSEEK_API_KEY`, `TOGETHER_API_KEY`, `GROQ_API_KEY`, `XAI_API_KEY`).
- For compatibility, the Groq and xAI entries keep using the legacy `lkv-groq-key` /
  `lkv-xai-key` files.
- Removing a provider deletes only its own `lkv-keys/` file. Legacy key files are never deleted.

`<userData>` is `~/.config/local-knowledge-vault` on Linux,
`~/Library/Application Support/local-knowledge-vault` on macOS and
`%APPDATA%\local-knowledge-vault` on Windows. `LKV_USER_DATA_DIR` overrides it (useful for a
throwaway profile).

## Migration from the old Groq / Grok settings

On first launch after the update, Vault builds `<userData>/lkv-providers.json` from
`lkv-llm.json`:

| Old setting | New selection |
|---|---|
| `provider: "groq"` | Groq only |
| `provider: "grok"` | xAI only |
| `provider: "ollama"` | Ollama only |
| `provider: "auto"` + Groq enabled | Groq only (old Auto tried Groq first) |
| `provider: "auto"` + only Grok enabled | xAI only |
| otherwise | Auto (local first) |

Groq and xAI entries are created with your old models and enable flags, and keep reading the
same key files. `lkv-llm.json` and the key files are left untouched. To go local-first, switch
**Use** to **Auto**.

A corrupt `lkv-providers.json` is copied aside (`lkv-providers.json.corrupt-<time>`) rather
than silently discarded.

## Privacy

- With a local provider, nothing leaves the computer.
- With a cloud provider, the question, the matching note passages, and recent chat turns are
  sent to that provider. Nothing else is sent.
- Health checks ping local servers only. Cloud providers aren't contacted until you ask something.
