# Local models: speeds and recommendations

Expected performance when Vault runs its AI on your own machine (#259, #275).
All timings below were measured on an 8-core, CPU-only box (no GPU); a GPU is
roughly an order of magnitude faster.

## Which model for which job

| Job | Recommended | Why |
| --- | --- | --- |
| Ask / Chat grounding (default) | `qwen3:8b` | Best at following the “answer only from these notes + cite” rules while staying small (~5 GB). `llama3.1:8b` is the alternative. |
| Study generation on CPU (cards, sample questions) | `qwen3:1.7b` | Follows the no-think setting and finishes a card in 15–25 s on CPU. Bigger qwen3 models are too slow there (see below). |
| Study generation on GPU | `qwen3:8b` or `qwen3:4b` | With real GPU throughput the larger models are affordable and write better questions. |

## Measured speeds (8-core CPU, Ollama 0.40.1)

| Model | Study card (one call) | Notes |
| --- | --- | --- |
| `qwen3:1.7b` | ~15–25 s | ~70% of hand-checked questions were good. Citations missing on 24–32% — Vault drops those and falls back to a cloze prompt. **Preferred CPU default for Study generation.** |
| `qwen3:4b` | ~3.2 tokens/s; one call ran 6.4 minutes | Ignored `think: false` and streamed untagged reasoning until the token cap with no usable output (#275). Too slow for CPU Study generation. |
| `openai/gpt-oss-20b` (Groq, cloud) | ~1–3 s | Fast, but reasoning tokens count against `max_tokens`: with small budgets, ~11% of structured calls came back empty or cut off mid-JSON (#275). |

## How Vault handles reasoning models (#275)

Reasoning models spend part of any output budget *thinking*. Structured
generation calls (study-card questions, sample questions, test parsing) are
wrapped by a guard in `electron/structured.ts`:

- **Budget** — one-note question generation requests ≥ 1,500 output tokens
  (retry: 3,000). On OpenAI-compatible providers (Groq, LM Studio, OpenRouter,
  vLLM …) the call also asks for `reasoning_effort: low`.
- **Ran out of tokens** — an empty reply, a `finish_reason`/`done_reason` of
  `length`, or JSON cut off mid-array is classified as ran-out, retried once
  with the larger budget, and otherwise surfaced as a clear error (and a
  fill-the-gap prompt in Study sessions). It is never read as “no questions”.
- **Untagged reasoning** — when a qwen3-family model ignores `think: false` and
  streams deliberation (“Wait, the answer must be short…”) instead of the asked
  -for shape, the call retries once with the `/no_think` soft switch appended;
  if that fails the reasoning is reported as an error, never shown as the
  answer.
