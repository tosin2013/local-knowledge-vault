# Vault study (v0.3.0)

Date: 2026-10-07
Scope: a code, architecture and maturity review of Vault (Local Knowledge Vault) v0.3.0.
Companion: [Effects on learning and retention](local-knowledge-vault-study-effects-on-learning.md)
(section 8 of this study, kept as a standalone file).

> Status: executive summary. This captures the findings as of the completed study; the detailed
> engineering write-up follows the author's original.

## What Vault is

Vault (v0.3.0) is a desktop app for macOS, Windows and Linux that answers questions only from your own
notes, using a model running on your machine. Every answer cites the note behind it (`[itm_…]`) or says
it couldn't find one, and that rule is enforced in the code, not only requested in the prompt
(`electron/generate.ts` — `validateCitations`, `UNCITED_LABEL`, and the no-hit refusal; `electron/search.ts`).
Notes live in a local SQLite database (`lkv.sqlite`).

## How it was assessed

A static review of the code and architecture, plus a full local test run.

## Test suite

The full suite passed on the author's machine: **305 UI tests and 966 backend checks**. The backend
checks are the `scripts/*.ts` smoke suites wired into `test:ci`; the UI tests are the Vitest renderer suite.

## Strengths

- **Grounding enforced in code.** Citations to notes that were not retrieved are dropped; answers that
  cite nothing are labelled; a no-hit query refuses without calling a model.
- **Local-first by default.** Ollama / LM Studio first, cloud optional and clearly flagged.
- **Typed, two-process architecture.** `electron/` owns data and LLM work; the renderer is typed against
  the preload surface.
- **Layered knowledge model.** Notes rank above raw transcript sources; unconfirmed `ai-draft` answers
  rank below confirmed notes (ADR 0002, `electron/search.ts`).

For a repository that is about two weeks old, it is unusually disciplined.

## Gaps

1. **Search is keyword-only.** SQLite FTS5 + BM25 with no embeddings (`electron/search.ts`), so it misses
   questions phrased differently from the note.
2. **Only the first 1,200 characters of each note reach the model** (`electron/generate.ts`), so long
   notes produce partial answers that can look complete.
3. **AI agents can't call it yet.** There is a bearer-token loopback HTTP bridge
   (`electron/bridge-server.ts`, `/v1/ask`) for the Obsidian plugin, but no MCP server, so a steward or
   agent can't use Vault as a tool.
4. **The notes database isn't encrypted.** Only secrets (API keys, bridge token) are encrypted
   (`electron/secret-store.ts`); `lkv.sqlite` is plain.
5. **One maintainer and no outside users so far.**

## Top three recommendations, in order

1. Add a way for AI agents to call Vault (an MCP server) that also works without the desktop app open.
2. Build a small test set that measures how accurate the citations are, and publish the numbers.
3. Improve search: split long notes into chunks, add optional meaning-based search, then close the
   privacy gaps.

It would also make a strong applied-proof article.

## Section 8: effects on learning and retention

Moved to the companion file:
[Effects on learning and retention](local-knowledge-vault-study-effects-on-learning.md). That section
draws on published learning research and labels every Vault-specific effect as a hypothesis to test.
