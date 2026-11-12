import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The web app is built into dist/web, which the console server serves. In development, /api goes to the console server
 * on its usual port, so the same paths work in both modes.
 */
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // A trailing slash, so the module /api.ts (imported by the page) is served by Vite and not proxied.
      '/api/': 'http://127.0.0.1:4180',
    },
  },
});
