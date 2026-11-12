import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Politique de sécurité du contenu : la page ne charge que ses propres fichiers et ne se connecte
 * qu'à l'API du coach. Si du code étranger s'y glissait, il ne pourrait envoyer ni la clé API ni
 * les données ailleurs. GitHub Pages n'envoie pas d'en-têtes : la politique va dans une balise
 * meta, ajoutée au build seulement, car le serveur de développement a besoin de scripts en ligne.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob:",
  "connect-src 'self' https://api.anthropic.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const contentSecurityPolicy = (): Plugin => ({
  name: 'wodhard-csp',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
});

export default defineConfig({
  // Chemins relatifs : l'appli fonctionne quel que soit le nom du dépôt GitHub Pages.
  base: './',
  plugins: [
    contentSecurityPolicy(),
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
