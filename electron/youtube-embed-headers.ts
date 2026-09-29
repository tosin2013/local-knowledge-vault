import type { BeforeSendResponse, OnBeforeSendHeadersListenerDetails } from 'electron'

/** Requests the header rewrite applies to (the YouTube embed document). */
export const YOUTUBE_EMBED_FILTER = {
  urls: [
    'https://*.youtube.com/embed/*',
    'https://*.youtube-nocookie.com/embed/*',
    'https://www.youtube.com/embed/*',
    'https://www.youtube-nocookie.com/embed/*',
  ],
}

/**
 * onBeforeSendHeaders listener for YOUTUBE_EMBED_FILTER.
 *
 * Packaged builds load the renderer via file://, so the youtube-nocookie embed
 * iframe is sent with a `null` origin and no Referer, which YouTube rejects with
 * player error 153. Rewrite those requests to carry the embed page's own origin
 * and a strict-origin Referer, mirroring what a browser sends when the embed is
 * loaded from a real page. Dev (localhost) is left untouched.
 *
 * Electron holds a matching request until `callback` runs, so it must be called
 * exactly once on every path (#116).
 */
export function rewriteYoutubeEmbedHeaders(
  details: Pick<OnBeforeSendHeadersListenerDetails, 'url' | 'referrer' | 'requestHeaders'>,
  callback: (response: BeforeSendResponse) => void
): void {
  const requestHeaders = details.requestHeaders
  try {
    const u = new URL(details.url)
    // Only rewrite when the embedding page is our file:// renderer (the packaged case).
    if (details.referrer === '' || details.referrer.startsWith('file://')) {
      requestHeaders['Referer'] = `${u.origin}/`
      requestHeaders['Origin'] = u.origin
    }
  } catch {
    /* leave headers untouched */
  }
  callback({ requestHeaders })
}
