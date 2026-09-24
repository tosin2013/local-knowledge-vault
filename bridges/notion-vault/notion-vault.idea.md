## Status

**Shipped path:** Vault in-app MCP client (Plugins → MCP connections → Connect Notion).

# Notion ↔ Vault — product idea (MCP-first)

## Problem

Teams live in Notion; Vault owns local grounded Ask + media transcripts. Building a custom Notion “plugin” like Obsidian’s community model is the wrong investment — Notion does not host that runtime.

## Preferred path

**Notion MCP / existing Notion connector** (Grok Bot, Cursor, or a future Vault MCP client). Agents already search, fetch, and update Notion through MCP. Vault remains the engine for notes + grounded citations.

## Other endpoints (same product, different clients)

1. **In-app plugins** — React panels inside Vault (Media chat, Media personas, MCP connections).
2. **Vault Bridge HTTP** — `127.0.0.1:8765` for Obsidian community plugins and local CLIs.
3. **MCP** — another plugin endpoint class: host tools talk to Notion (and later Vault) over MCP instead of a bespoke Notion plugin.

## Non-goals

- Custom Notion community-style plugin
- Bidirectional live sync as v0
- Replacing Notion AI inside Notion’s UI with Vault
- Shipping Notion OAuth in the in-app stub

## Success metric (later)

An agent session using Notion MCP + Vault (app or Bridge) can answer from vault transcripts with `[itm_…]` citations and paste or file results into Notion — without copying Vault notes into Notion as the source of truth.
