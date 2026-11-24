import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Cambio PWA',
        short_name: 'Cambio',
        theme_color: '#5a4df5',
        background_color: '#f8f9ff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/favicon.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
          {
            src: '/favicon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.currencyfreaks\.com\/v2\.0\/rates\/latest/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'currency-rates-cache',
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxEntries: 24,
                maxAgeSeconds: 60 * 60 * 6,
              },
              matchOptions: {
                ignoreSearch: false,
              },
            },
          },
        ],
      },
    }),
  ],
})
