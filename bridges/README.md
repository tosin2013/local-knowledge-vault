# Vault bridges (Obsidian & Notion)

**Architecture:** Vault owns notes + grounded Ask. Obsidian and Notion are **front doors** that call a **local Vault Bridge HTTP API**. Vault is not becoming Obsidian (or Notion).

```
  Obsidian plugin / Notion script / CLI
              │
              │  HTTP JSON (loopback)
              ▼
     Vault Bridge  http://127.0.0.1:8765
              │
              ▼
     Vault engine (SQLite notes, FTS, grounded Ask, Media)
```

## Bridge API (v0)

Started automatically when the Vault Electron app is ready. Bound to **`127.0.0.1` only** (loopback).

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/health` | — | `{ ok, name: "Vault Bridge", version }` |
| `GET` | `/v1/projects` | — | `{ projects: [{ project, noteCount, source? }] }` |
| `POST` | `/v1/ask` | `{ text, project?, promptId? }` | `{ answer, citations }` |

### Security (v0)

- **Local only** — listens on `127.0.0.1:8765`, not `0.0.0.0`.
- **No auth yet** — anyone on your machine can hit the API while Vault is running. Fine for a personal workstation; do not tunnel or port-forward this port.
- Toggle / auth / token can come later; this scaffold is intentionally minimal.

### Quick curl

```bash
# Health
curl -s http://127.0.0.1:8765/health | jq .

# Projects
curl -s http://127.0.0.1:8765/v1/projects | jq .

# Grounded ask (optionally scope to a media/vault project)
curl -s -X POST http://127.0.0.1:8765/v1/ask \
  -H 'Content-Type: application/json' \
  -d '{"text":"What was said about rates?","project":"my-video"}' | jq .
```

Run the **Vault app first** so the Bridge is listening.

## Plugin endpoint classes

Alongside in-app Vault plugins:

- **Vault Bridge HTTP** (this doc) — Obsidian / local tools → `127.0.0.1:8765`
- **MCP (in-app client)** — preferred for **Notion**: Plugins → **MCP connections** → Connect Notion (`https://mcp.notion.com/mcp` + OAuth inside Vault). Cursor/Grok connectors are optional extras, not the only path. Custom Notion community-style plugins are out of scope. See [`notion-vault/README.md`](./notion-vault/README.md).

## Scaffolds in this folder

| Path | What |
|------|------|
| [`obsidian-vault/`](./obsidian-vault/) | Obsidian community plugin scaffold — “Ask Vault…” / “Vault health” |
| [`notion-vault/`](./notion-vault/) | **In-app MCP client** (preferred) + notes; optional Bridge CLI stub (`scripts/ask-vault.mjs`) |

Full production sync is **not** shipped here — these prove the direction: Vault as engine, other apps as clients.
