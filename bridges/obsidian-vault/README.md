# Obsidian → Vault Bridge (scaffold)

Obsidian stays your markdown vault UI. **Vault** stays the grounded Ask engine. This plugin calls Vault’s local Bridge API — it does not sync Obsidian notes into Vault (yet).

## Prerequisites

1. Run the **Vault** desktop app (Bridge listens on `http://127.0.0.1:8765`).
2. Obsidian desktop with **Community plugins** enabled.

## Install

```bash
# From your Obsidian vault root:
mkdir -p .obsidian/plugins/vault-bridge
cp -R /path/to/local-knowledge-vault/bridges/obsidian-vault/* .obsidian/plugins/vault-bridge/
```

Then in Obsidian: **Settings → Community plugins →** enable **Vault Bridge** (turn off Safe mode if needed).

The folder ships `main.js` (no build required) plus `main.ts` as the typed source.

## Commands

| Command | What |
|---------|------|
| **Vault health** | `GET /health` — confirms Bridge is up |
| **Ask Vault…** | Prompt → `POST /v1/ask` → inserts answer + citations into the active note |

## Settings

- **Bridge base URL** — default `http://127.0.0.1:8765`
- **Default project** — optional Vault/media project scope

## Security

Bridge is loopback-only and has **no auth in v0**. Only use on a trusted machine; keep Vault running only when you need it.
