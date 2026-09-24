/**
 * Smoke: OAuth discovery against Notion MCP (no user login / no token exchange).
 *
 *   npx tsx scripts/mcp-notion-discovery-smoke.ts
 *
 * To try full Connect Notion in the app:
 *   1. npm run dev
 *   2. Plugins → MCP connections → Connect Notion
 *   3. Authorize in the browser (callback http://127.0.0.1:17342/oauth/callback)
 */
import { discoverOAuthMetadata } from '../electron/mcp-client'

const MCP_URL = 'https://mcp.notion.com/mcp'

async function main(): Promise<void> {
  console.log('Discovering OAuth for', MCP_URL)
  const meta = await discoverOAuthMetadata(MCP_URL)
  console.log('issuer:', meta.issuer)
  console.log('authorization_endpoint:', meta.authorization_endpoint)
  console.log('token_endpoint:', meta.token_endpoint)
  console.log('registration_endpoint:', meta.registration_endpoint)
  console.log('PKCE methods:', meta.code_challenge_methods_supported)
  if (!meta.authorization_endpoint || !meta.token_endpoint || !meta.registration_endpoint) {
    throw new Error('Missing required OAuth endpoints')
  }
  if (!meta.code_challenge_methods_supported?.includes('S256')) {
    console.warn('WARN: S256 not advertised (Vault still uses S256)')
  }
  console.log('OK — discovery smoke passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
