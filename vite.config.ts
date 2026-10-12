import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Production-only <head> additions that depend on the Supabase URL:
 * - a strict Content-Security-Policy (scripts only from our own origin,
 *   network only to our origin + Supabase)
 * - a preconnect so the TLS handshake to Supabase overlaps app boot.
 * Dev is left alone because Vite's HMR needs inline scripts and websockets.
 */
function productionHead(supabaseUrl: string | undefined): Plugin {
  return {
    name: 'release-tracker:production-head',
    apply: 'build',
    transformIndexHtml() {
      if (!supabaseUrl) {
        throw new Error(
          'VITE_SUPABASE_URL must be set for production builds. ' +
            'Locally: .env.local. Cloudflare Workers: Settings → Build → Variables and secrets. ' +
            'Cloudflare Pages: Settings → Variables and Secrets (Production and Preview).',
        )
      }
      // Self-hosted stack (Docker): API on the app's own origin, any host/port.
      const sameOrigin = supabaseUrl === 'same-origin'
      const api = sameOrigin ? null : new URL(supabaseUrl)
      const connect = api
        ? `'self' ${api.origin} ${api.protocol === 'https:' ? 'wss:' : 'ws:'}//${api.host}`
        : // 'self' covers same-origin ws: in current browsers; listed for older ones.
          "'self' ws: wss:"
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        // Radix positions popovers with inline style attributes.
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self'",
        `connect-src ${connect}`,
        "worker-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        ...(api?.protocol === 'https:' ? ['upgrade-insecure-requests'] : []),
      ].join('; ')

      return [
        { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' },
        ...(api ? [{ tag: 'link', attrs: { rel: 'preconnect', href: api.origin, crossorigin: '' }, injectTo: 'head' as const }] : []),
      ]
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [
      react(),
      tailwindcss(),
      productionHead(env.VITE_SUPABASE_URL),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
        manifest: {
          name: 'Release Tracker',
          short_name: 'Releases',
          description: 'Track release candidates from identification to deployment.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#ffffff',
          theme_color: '#171717',
          icons: [
            { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Precache the app shell only. Supabase (data + auth) is never
          // intercepted, so no release data or tokens land in the SW cache.
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    build: {
      sourcemap: false,
      rolldownOptions: {
        output: {
          // Stable vendor chunks: app deploys don't invalidate cached libraries.
          // UI primitives (Radix, cmdk) are deliberately NOT grouped: a single
          // group made every page (incl. login) download all of them.
          codeSplitting: {
            groups: [
              { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/, priority: 30 },
              { name: 'supabase', test: /[\\/]node_modules[\\/]@supabase[\\/]/, priority: 20 },
            ],
          },
        },
      },
    },
  }
})
