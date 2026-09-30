/**
 * Add from URL — fetch page, extract readable text, auto-tag (LLM or heuristic), create note.
 * Pure helpers exported for unit tests.
 */
import { createItem } from './db'
import { llmGenerate } from './llm'
import type { ImportFromUrlResult, Item, Para } from './types'

const FETCH_TIMEOUT_MS = 15_000
const MAX_BODY_BYTES = 500 * 1024
const MAX_REDIRECTS = 5
const MAX_BODY_CHARS = 12_000
const SUMMARY_FALLBACK_CHARS = 240

const PARA_SET = new Set<Para>(['projects', 'areas', 'resources', 'archives'])

// Private/internal IP ranges to block (SSRF protection)
const PRIVATE_IPV4_RANGES: [string, number][] = [
  ['10.0.0.0', 8],        // 10.0.0.0/8
  ['172.16.0.0', 12],     // 172.16.0.0/12
  ['192.168.0.0', 16],    // 192.168.0.0/16
  ['127.0.0.0', 8],       // 127.0.0.0/8 (loopback)
  ['169.254.0.0', 16],    // 169.254.0.0/16 (link-local)
  ['224.0.0.0', 4],       // 224.0.0.0/4 (multicast)
  ['0.0.0.0', 8],         // 0.0.0.0/8 (reserved)
]

// IPv6 private ranges (simplified check for common cases)
const PRIVATE_IPV6_PREFIXES = [
  '::1',          // loopback
  'fe80:',        // link-local
  'fc00:',        // unique local
  'fd00:',        // unique local
]

function ipToNumber(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0
}

function cidrMatch(ip: string, cidrIp: string, prefixLen: number): boolean {
  const ipNum = ipToNumber(ip)
  const cidrNum = ipToNumber(cidrIp)
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0
  return (ipNum & mask) === (cidrNum & mask)
}

function isPrivateIpv4(hostname: string): boolean {
  // Check if hostname is an IPv4 address
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return false
  for (const [cidrIp, prefixLen] of PRIVATE_IPV4_RANGES) {
    if (cidrMatch(hostname, cidrIp, prefixLen)) return true
  }
  return false
}

function isPrivateIpv6(hostname: string): boolean {
  // Check if hostname is an IPv6 address (simplified)
  // URL parser returns IPv6 hostnames with brackets, e.g., "[::1]"
  let addr = hostname.toLowerCase()
  // Remove brackets if present
  if (addr.startsWith('[') && addr.endsWith(']')) {
    addr = addr.slice(1, -1)
  }
  // Remove zone ID if present (e.g., fe80::1%eth0)
  addr = addr.split('%')[0]
  if (!addr.includes(':')) return false
  // Normalize IPv6 for prefix checks
  if (addr === '::1') return true
  if (addr.startsWith('fe80:')) return true
  if (addr.startsWith('fc00:') || addr.startsWith('fd00:')) return true
  // IPv4-mapped IPv6 addresses (::ffff:10.x.x.x, etc.)
  const ipv4Mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (ipv4Mapped) return isPrivateIpv4(ipv4Mapped[1])
  return false
}

function isPrivateHostname(hostname: string): boolean {
  // Allow bypass for testing via environment variable
  if (process.env.ALLOW_PRIVATE_IPS === '1') return false
  // Direct IP address checks
  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) return true
  // Hostname-based checks for common localhost aliases
  const lower = hostname.toLowerCase()
  if (lower === 'localhost' || lower === 'localhost.localdomain') return true
  // Note: We don't resolve hostnames here to avoid DNS rebinding.
  // The actual IP check happens in fetchPageHtml after DNS resolution.
  return false
}

/** Allow http(s) only; block file://, private IPs, localhost, and other schemes. */
export function isAllowedUrl(
  raw: string
): { ok: true; url: URL } | { ok: false; error: string } {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return { ok: false, error: 'URL is empty' }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, error: 'Invalid URL' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http and https URLs are allowed' }
  }
  // Block private hostnames (localhost, IP literals)
  if (isPrivateHostname(parsed.hostname)) {
    return { ok: false, error: 'Private network addresses are not allowed' }
  }
  return { ok: true, url: parsed }
}

/**
 * Resolve hostname and verify none of the resolved IPs are private/internal.
 * This prevents DNS rebinding attacks where a domain resolves to a private IP.
 */
export async function verifyPublicHostname(hostname: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // Allow bypass for testing via environment variable
  if (process.env.ALLOW_PRIVATE_IPS === '1') return { ok: true }
  // Skip if already an IP literal (already checked in isAllowedUrl)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':')) {
    return { ok: true }
  }
  try {
    const { promises: dns } = await import('dns')
    const addresses = await dns.resolve4(hostname)
    for (const addr of addresses) {
      if (isPrivateIpv4(addr)) {
        return { ok: false, error: `Hostname resolves to private IP: ${addr}` }
      }
    }
    // Also check IPv6
    try {
      const addresses6 = await dns.resolve6(hostname)
      for (const addr of addresses6) {
        if (isPrivateIpv6(addr)) {
          return { ok: false, error: `Hostname resolves to private IPv6: ${addr}` }
        }
      }
    } catch {
      // IPv6 not available or no AAAA records - that's fine
    }
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // DNS resolution failure - could be network issue or domain doesn't exist
    // We allow the fetch to proceed and let it fail naturally
    console.warn(`DNS resolution failed for ${hostname}: ${msg}`)
    return { ok: true }
  }
}

export interface ExtractedPage {
  title: string
  text: string
}

export interface AutoTags {
  title: string
  summary: string
  para: Para
  kind: string
  project: string | null
  status: string
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function metaContent(html: string, prop: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    'i'
  )
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
    'i'
  )
  const m = html.match(re) ?? html.match(re2)
  return m ? decodeEntities(m[1].trim()) : null
}

function firstMatch(html: string, re: RegExp): string | null {
  const m = html.match(re)
  if (!m) return null
  const inner = m[1] ?? ''
  const text = stripTags(inner)
  return text || null
}

/** Extract title + readable body text from HTML (no DOM deps). */
export function extractFromHtml(html: string): ExtractedPage {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')

  const titleTag = firstMatch(cleaned, /<title[^>]*>([\s\S]*?)<\/title>/i)
  const ogTitle = metaContent(html, 'og:title')
  const h1 = firstMatch(cleaned, /<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const title = (ogTitle || titleTag || h1 || 'Untitled').slice(0, 300)

  const mainInner = cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1]
  const articleInner = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1]
  const bodyInner = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]
  const bodyHtml = mainInner || articleInner || bodyInner || cleaned
  const text = stripTags(bodyHtml)

  return { title, text }
}

function hostnameLabel(urlStr: string): string {
  try {
    const host = new URL(urlStr).hostname.replace(/^www\./i, '')
    return host || 'web'
  } catch {
    return 'web'
  }
}

export function heuristicTags(url: string, title: string, text: string): AutoTags {
  const summary = text.slice(0, SUMMARY_FALLBACK_CHARS).trim() || title
  return {
    title: title.trim() || hostnameLabel(url),
    summary,
    para: 'resources',
    kind: 'article',
    project: hostnameLabel(url),
    status: 'active',
  }
}

/** Parse LLM JSON response; returns null if invalid / missing required shape. */
export function parseAutoTagJson(raw: string): AutoTags | null {
  if (!raw || typeof raw !== 'string') return null
  let text = raw.trim()
  // Strip markdown fences if present
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  // Find first { ... } object
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  text = text.slice(start, end + 1)
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  const summary = typeof o.summary === 'string' ? o.summary.trim() : ''
  if (!title) return null

  let para: Para = 'resources'
  if (typeof o.para === 'string' && PARA_SET.has(o.para as Para)) {
    para = o.para as Para
  }

  const kind =
    typeof o.kind === 'string' && o.kind.trim() ? o.kind.trim().toLowerCase() : 'article'

  let project: string | null = null
  if (o.project === null || o.project === undefined) {
    project = null
  } else if (typeof o.project === 'string') {
    const p = o.project.trim()
    project = p && p.toLowerCase() !== 'null' ? p.slice(0, 80) : null
  }

  const status =
    typeof o.status === 'string' && o.status.trim() ? o.status.trim() : 'active'

  return {
    title: title.slice(0, 300),
    summary: (summary || title).slice(0, 500),
    para,
    kind,
    project,
    status,
  }
}

function buildBody(url: string, fetchedAt: string, summary: string, text: string): string {
  const truncated = text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) + '\n…' : text
  const blurb = summary.trim() || text.slice(0, SUMMARY_FALLBACK_CHARS).trim()
  return [
    `Source URL: ${url}`,
    `Fetched: ${fetchedAt}`,
    '',
    blurb,
    '',
    '---',
    truncated,
  ].join('\n')
}

function buildAutoTagPrompt(url: string, title: string, text: string): string {
  const excerpt = text.slice(0, 4000)
  return `You tag notes for a personal PARA knowledge vault.
Return STRICT JSON only (no markdown, no commentary) with exactly this shape:
{"title":"string","summary":"string","para":"projects|areas|resources|archives","kind":"article|docs|blog|reference","project":"short label or null","status":"active"}

Rules:
- para: use "resources" for most articles/docs; "projects" only if clearly a project; "areas" for ongoing responsibilities; "archives" for obsolete material.
- kind: article (default for web pages), docs, blog, or reference.
- project: short topic label (e.g. domain-derived like "SpaceX study") or null.
- status: always "active".
- title: clean page title, concise.
- summary: 1–2 sentences, max ~240 chars.

Source URL: ${url}
Page title: ${title}

Excerpt:
${excerpt}`
}

async function readBodyLimited(res: Response, maxBytes: number): Promise<string> {
  const lenHeader = res.headers.get('content-length')
  if (lenHeader) {
    const n = Number(lenHeader)
    if (Number.isFinite(n) && n > maxBytes) {
      throw new Error(`Page too large (${n} bytes; max ${maxBytes})`)
    }
  }

  if (!res.body) {
    const t = await res.text()
    return t.slice(0, maxBytes)
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      chunks.push(value.slice(0, Math.max(0, value.byteLength - (total - maxBytes))))
      try {
        await reader.cancel()
      } catch {
        /* ignore */
      }
      break
    }
    chunks.push(value)
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)))
  return buf.toString('utf8')
}

async function fetchPageHtml(
  startUrl: string
): Promise<{ html: string; finalUrl: string }> {
  let current = startUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const allowed = isAllowedUrl(current)
    if (!allowed.ok) throw new Error(allowed.error)

    // Verify the hostname resolves to a public IP (prevents DNS rebinding)
    const hostname = new URL(current).hostname
    const dnsCheck = await verifyPublicHostname(hostname)
    if (!dnsCheck.ok) throw new Error(dnsCheck.error)

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'LocalKnowledgeVault/0.1 (personal vault; +https://localhost)',
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/abort/i.test(msg)) throw new Error('Fetch timed out (~15s)')
      throw new Error(`Fetch failed: ${msg}`)
    } finally {
      clearTimeout(timer)
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new Error(`Redirect ${res.status} without Location`)
      if (hop === MAX_REDIRECTS) throw new Error('Too many redirects')
      current = new URL(loc, current).href
      continue
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching URL`)
    }

    const ctype = (res.headers.get('content-type') ?? '').toLowerCase()
    if (ctype && !/text\/html|application\/xhtml|text\/plain/i.test(ctype)) {
      // Still try if unclear; reject obvious binary
      if (/image\/|audio\/|video\/|application\/octet|application\/pdf/i.test(ctype)) {
        throw new Error(`Unsupported content-type: ${ctype}`)
      }
    }

    const html = await readBodyLimited(res, MAX_BODY_BYTES)
    return { html, finalUrl: current }
  }
  throw new Error('Too many redirects')
}

async function autoTag(
  url: string,
  title: string,
  text: string
): Promise<{ tags: AutoTags; tagsSource: 'llm' | 'heuristic'; warning?: string }> {
  const fallback = heuristicTags(url, title, text)
  try {
    const prompt = buildAutoTagPrompt(url, title, text)
    const gen = await llmGenerate(prompt)
    if (!gen.ok) {
      return {
        tags: fallback,
        tagsSource: 'heuristic',
        warning: `LLM unavailable (${gen.error}); used heuristic tags`,
      }
    }
    const parsed = parseAutoTagJson(gen.text)
    if (!parsed) {
      return {
        tags: fallback,
        tagsSource: 'heuristic',
        warning: 'LLM returned invalid JSON; used heuristic tags',
      }
    }
    // Fill gaps from page/heuristic
    return {
      tags: {
        ...parsed,
        title: parsed.title || fallback.title,
        summary: parsed.summary || fallback.summary,
        status: parsed.status || 'active',
      },
      tagsSource: 'llm',
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      tags: fallback,
      tagsSource: 'heuristic',
      warning: `Auto-tag failed (${msg}); used heuristic tags`,
    }
  }
}

/**
 * Fetch URL → extract → auto-tag → createItem.
 * Does not log secrets. Stores URL provenance in body only (no schema change).
 */
export async function importFromUrl(rawUrl: string): Promise<ImportFromUrlResult> {
  const allowed = isAllowedUrl(rawUrl)
  if (!allowed.ok) {
    throw new Error(allowed.error)
  }
  const startUrl = allowed.url.href

  const { html, finalUrl } = await fetchPageHtml(startUrl)
  const extracted = extractFromHtml(html)
  const fetchedAt = new Date().toISOString()
  const { tags, tagsSource, warning } = await autoTag(
    finalUrl,
    extracted.title,
    extracted.text
  )

  const body = buildBody(finalUrl, fetchedAt, tags.summary, extracted.text)
  const item: Item = createItem({
    title: tags.title,
    summary: tags.summary,
    body,
    para: tags.para,
    kind: tags.kind,
    status: tags.status,
    project: tags.project,
  })

  return { item, tagsSource, warning }
}
