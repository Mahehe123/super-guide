import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// Served from https://mahehe123.github.io/super-guide/
export default defineConfig({
  base: '/super-guide/',
  plugins: [
    preact(),
    VitePWA({
      // Ask before swapping in a new version so nothing reloads mid-entry.
      registerType: 'prompt',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/icon.svg'],
      manifest: {
        id: '/super-guide/',
        name: 'Hiyo — Expense Manager',
        short_name: 'Hiyo',
        description: 'Expenses, income, claims and trips. Everything stays on your phone.',
        lang: 'en-MY',
        start_url: '/super-guide/',
        scope: '/super-guide/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#FFF8F6',
        background_color: '#FFF8F6',
        categories: ['finance', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          {
            name: 'Add entry',
            short_name: 'Add',
            url: '/super-guide/?add=1',
            icons: [{ src: 'icons/shortcut-add-96.png', sizes: '96x96', type: 'image/png' }],
          },
          { name: 'Claims', short_name: 'Claims', url: '/super-guide/#/claims' },
        ],
      },
      workbox: {
        // App shell + woff2 fonts; woff fallbacks aren't needed on Android Chrome.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/super-guide/index.html',
        cleanupOutdatedCaches: true,
        // Take over as soon as a new version downloads, so a broken copy can always be replaced.
        // The running page isn't reloaded; the new version loads on the next open.
        skipWaiting: true,
        clientsClaim: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5178 },
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
  },
});
