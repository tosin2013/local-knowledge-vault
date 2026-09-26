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

### Security (v1)

- **Local only** — listens on `127.0.0.1:8765`, not `0.0.0.0`.
- **Bearer auth** — `/v1/projects` and `/v1/ask` require `Authorization: Bearer <token>`. The token
  is generated per install, stored at `<userData>/lkv-bridge-token` (0600), and shown in
  **Vault → AI providers → Vault Bridge**. `/health` stays open for liveness.
- **Host allowlist** — requests with a non-loopback `Host` header are rejected (DNS-rebinding guard).
- **JSON only** — `POST /v1/ask` requires `Content-Type: application/json`.
- **Size-capped** — request bodies over 64 KB are rejected with `413`.
- **No CORS** — responses carry no `Access-Control-Allow-Origin`, so a browser page cannot read them.

### Quick curl

```bash
TOKEN="<from Vault → AI providers → Vault Bridge>"

# Health (no auth)
curl -s http://127.0.0.1:8765/health | jq .

# Projects
curl -s http://127.0.0.1:8765/v1/projects \
  -H "Authorization: Bearer $TOKEN" | jq .

# Grounded ask (optionally scope to a media/vault project)
curl -s -X POST http://127.0.0.1:8765/v1/ask \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
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
