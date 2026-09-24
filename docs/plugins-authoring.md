# Writing a Vault plugin (plugin.json)

Vault plugins are **declarative packs**: a folder with a `plugin.json` plus optional text and
image assets. They **cannot run code**. There are no scripts, no `main` entry and no custom
headers. That makes them safe to share as a zip.

A plugin can contribute:

| Type | What it adds | Where it shows up |
|---|---|---|
| `providers` | Provider presets (base URL + default model) | Add provider → "From plugins", and the provider list (off until enabled) |
| `personas` | Voices for Media chat / Ask (style only; grounding rules are fixed) | Plugins → Media personas → "From plugins" → Install |
| `promptPacks` | Quick-ask prompts | Chips in the empty Ask screen |
| `mcpServers` | MCP server presets (name + URL; OAuth happens on Connect) | Plugins → MCP connections → "Suggested by plugins" |

## Folder layout

```
study-buddy/
  plugin.json      required
  persona.md       optional, referenced via "promptFile"
  icon.png         optional, ≤ 256 KB, shown in Manage plugins
```

Only `.json .md .txt .png .jpg .jpeg .webp .svg` files are copied on install. Anything else is
skipped with a warning.

## plugin.json reference (schemaVersion 1)

```jsonc
{
  "schemaVersion": 1,                 // required, must be 1
  "id": "study-buddy",                // required, 2–64 chars: a-z 0-9 -
  "name": "Study buddy",              // required, ≤ 80 chars
  "version": "1.0.0",                 // required, semver-ish
  "description": "…",                 // optional
  "author": "…",                      // optional
  "homepage": "https://…",            // optional
  "contributes": {                    // required, at least one entry overall, ≤ 20 per type
    "providers": [{
      "id": "free-router",            // a-z 0-9 . _ -  (unique within the plugin)
      "label": "OpenRouter · Free",   // ≤ 60 chars
      "kind": "openai-compatible",    // openai-compatible | anthropic | ollama | gemini
      "baseUrl": "https://openrouter.ai/api/v1", // https, or http only for localhost / LAN
      "defaultModel": "openrouter/free",
      "local": false,                 // optional (default false)
      "requiresKey": true,            // optional (default: true unless local)
      "docsUrl": "https://…",         // optional
      "notes": "Shown in the Add provider dialog" // optional, ≤ 300 chars
    }],
    "personas": [{
      "name": "Study buddy",          // ≤ 60 chars
      "description": "…",             // optional
      "prompt": "Speak like …"        // or "vibe", or "promptFile": "persona.md" (≤ 16 KB)
    }],
    "promptPacks": [{
      "name": "Revision",
      "prompts": ["Quiz me on …", "Summarize …"]  // non-empty strings ≤ 300 chars
    }],
    "mcpServers": [{
      "name": "Notion",
      "url": "https://mcp.notion.com/mcp",        // https (http only for localhost)
      "description": "…"
    }]
  }
}
```

Rejected, with a clear message in Manage plugins:

- a wrong `schemaVersion`, a bad `id` or a missing `version`
- `main` / `scripts` / `code`
- unknown contribution types
- `apiKey` / `key` / `token` / `headers` on providers (users add their own key)
- auth fields on MCP servers
- plain-http remote URLs
- invalid JSON (the error names the line)

## Personas and grounding

A persona only sets **style**. Vault wraps it in the fixed grounding rules: answer only from the
retrieved notes, cite `[itm_…]`, and say "I don't know" when the notes don't cover it. A persona
can't turn those rules off.

## Install, test, share

- **Install:** Plugins → **Manage plugins** → **Install folder…** or **Install .zip…**. You can
  also copy the folder into `<userData>/plugins/<id>/` and press **Reload**.
- **Update:** install again. The previous version is moved to `plugins/.previous/`.
- **Remove:** the plugin is moved to `<userData>/plugins-removed/` so it can be recovered.
- **Enable / disable:** the switch in Manage plugins. Built-in panels (Media chat, Media personas,
  MCP connections) can be hidden the same way.
- **Share:** zip the folder, with `plugin.json` either at the root or inside one top-level folder.

Examples are in [`examples/plugins/`](../examples/plugins):

- `openrouter-free-models` has provider presets.
- `study-buddy` has personas, one loaded from `persona.md`, plus a prompt pack and an MCP preset.

## What about code plugins?

Built-in panels are React code in `src/plugins/` (see [PLUGINS.md](../PLUGINS.md)). Third-party
**code** plugins may come later, behind a permission model. For now, sharable plugins are data
only, on purpose.
