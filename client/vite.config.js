/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      manifest: {
        // Nombre neutro: la misma app la usan Kazaro y Pazar, y el manifiesto es
        // único para todo el despliegue (no se puede variar según quién entra).
        name: 'Insumos',
        short_name: 'Insumos',
        description: 'Gestión de pedidos de insumos',
        theme_color: '#0b1220',
        // El mismo color que la barra de la app, NO blanco. iOS usa este color
        // para la franja del reloj en la app instalada y para la pantalla de
        // arranque: en blanco dejaba un degradado blanco arriba de todo.
        background_color: '#0b1220',
        // 'browser' y no 'standalone': en pantalla completa iOS dibuja él la
        // franja del reloj con un degradado que no se puede controlar desde la
        // página (probado el 22/10/2026 contra theme-color, background_color,
        // viewport-fit, la barra de estado y el fondo del documento: ninguno lo
        // mueve). Como pestaña de Safari esa franja es la barra del navegador.
        // Ojo: la meta apple-mobile-web-app-capable hace lo mismo por su cuenta
        // y también hubo que sacarla de index.html.
        display: 'browser',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
  },
})