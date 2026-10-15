import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
// The Express server (server/) sends the security headers, including the CSP.
export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
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
          // Precache the app shell only. API responses (data + auth) are never
          // intercepted, so no release data or tokens land in the SW cache.
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          navigateFallback: 'index.html',
          // API calls always go to the network.
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    server: {
      // Development: the API runs separately (npm run dev:server).
      proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
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
            ],
          },
        },
      },
    },
  }
})
