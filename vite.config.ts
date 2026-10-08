import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Chemins relatifs : l'appli fonctionne quel que soit le nom du dépôt GitHub Pages.
  base: './',
  plugins: [
    VitePWA({
      // La nouvelle version est prise au lancement suivant, jamais par un rechargement en plein WOD.
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'WODHARD',
        short_name: 'WODHARD',
        description: 'Suivi personnel de WOD : chrono, scores et historique.',
        lang: 'fr',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0d0e10',
        theme_color: '#0d0e10',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
