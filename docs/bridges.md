# Bridges & plugin endpoints

Vault is the engine (notes + grounded Ask). External tools connect through a few **endpoint classes**:

| Endpoint class | Who uses it | Notes |
|----------------|-------------|--------|
| **In-app plugins** | Vault UI panels | Media chat, Media personas, **MCP connections** — see [`PLUGINS.md`](../PLUGINS.md). |
| **Vault Bridge HTTP** | Obsidian plugin, local CLIs | Loopback `http://127.0.0.1:8765` while the Vault app runs. Prefer this for Obsidian / scripts. See [`../bridges/README.md`](../bridges/README.md). |
| **MCP (in-app client)** | Vault → Notion MCP + other remote MCP servers | **Preferred Notion path.** Plugins → MCP connections → Connect Notion (`https://mcp.notion.com/mcp` + OAuth). Not “use Cursor’s connector only.” |

Obsidian remains the HTTP Bridge front door; Notion should go through **Vault’s MCP client**. Scaffolds: `bridges/obsidian-vault/`, `bridges/notion-vault/` (MCP-first README + optional CLI stub).
