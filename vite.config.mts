import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

/**
 * Development CSP (relaxed): React Fast Refresh injects inline scripts and Vite
 * HMR uses WebSocket + localhost, so `script-src` keeps 'unsafe-inline'/'unsafe-eval'
 * and `connect-src` re-allows ws/localhost. Production keeps the strict CSP that is
 * baked into index.html (no unsafe-inline/eval, connect-src 'self').
 */
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com https://www.youtube-nocookie.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: https:",
  "media-src 'self' blob: lkvmedia:",
  "connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:* https://www.youtube.com https://www.youtube-nocookie.com",
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://*.youtube.com",
].join('; ')

/** Swap the strict CSP for a relaxed one in dev only (skipped on `vite build`). */
function relaxCspForDev(): Plugin {
  return {
    name: 'relax-csp-for-dev',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        /<meta http-equiv="Content-Security-Policy"[^>]*>/,
        `<meta http-equiv="Content-Security-Policy" content="${DEV_CSP}" />`
      )
    },
  }
}

export default defineConfig({
  plugins: [
    relaxCspForDev(),
    react(),
    tailwindcss(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['better-sqlite3', 'electron'],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
  },
})
