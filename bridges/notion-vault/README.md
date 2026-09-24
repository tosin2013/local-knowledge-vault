# Notion → Vault (preferred: in-app MCP client)

**Preferred Notion path = Vault’s in-app MCP client**, connecting to Notion’s official hosted MCP at `https://mcp.notion.com/mcp` with OAuth.

Do **not** build a custom Notion community-style plugin. Do **not** rely only on Cursor / Grok Bot’s Notion connector — Vault itself can connect.

| Path | Status | What to do |
|------|--------|------------|
| **In-app MCP client** | **Preferred** | Plugins → **MCP connections** → **Connect Notion**. Vault runs OAuth (PKCE + dynamic registration), stores tokens under app userData, and lists Notion MCP tools. |
| **Cursor / Grok Bot Notion connector** | Optional | Still useful in agent hosts; not a substitute for Vault’s own client. |
| **Vault Bridge HTTP** | Available | Loopback `127.0.0.1:8765` for Obsidian plugins and local scripts (`ask-vault.mjs`). **Not** the preferred Notion path. |
| **Custom Notion plugin** | **Out of scope** | No Notion “community plugin” equivalent worth building for Vault. |

## How to connect Notion in Vault

1. Start the Vault app.
2. Open **Plugins → MCP connections**.
3. Click **Connect Notion** (preset URL `https://mcp.notion.com/mcp`).
4. Complete OAuth in the browser (loopback redirect `http://127.0.0.1:17342/oauth/callback`).
5. When connected, the panel shows status, optional workspace/user identity from the token response, and the tool list (`tools/list`).

You can also **Add MCP server** with any remote Streamable HTTP MCP URL.

## Optional Bridge HTTP CLI

Still useful for local Ask without MCP:

```bash
# Vault app must be running (Bridge HTTP)
node bridges/notion-vault/scripts/ask-vault.mjs "What did the clip say about inflation?"
```

## Smoke-test OAuth discovery (no user login)

```bash
npx tsx scripts/mcp-notion-discovery-smoke.ts
```

See also [`notion-vault.idea.md`](./notion-vault.idea.md) and [`docs/bridges.md`](../../docs/bridges.md).
