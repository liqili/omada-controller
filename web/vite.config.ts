/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev mode proxies /controller-api to the Omada controller exactly like the
// production nginx sidecar (web/nginx.conf) so code paths are identical.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/controller-api': {
        // OMADA_TARGET points dev mode at another controller (or a mock).
        target: process.env.OMADA_TARGET ?? 'https://localhost:8043',
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/controller-api/, ''),
        configure: (proxy) => {
          // Dev origin is http — strip the Secure flag from the controller's
          // session cookie or the browser discards it (matches nginx.conf).
          proxy.on('proxyRes', (proxyRes) => {
            const cookies = proxyRes.headers['set-cookie'];
            if (cookies) {
              proxyRes.headers['set-cookie'] = cookies.map((c) => c.replace(/;\s*Secure/i, ''));
            }
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Libraries in their own long-lived chunks: an app-only redeploy
        // leaves them cached. Pages split themselves via lazy() in App.tsx.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](@mui|@emotion|@popperjs|react-transition-group)[\\/]/.test(id)) return 'mui';
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|@remix-run|scheduler)[\\/]/.test(id)) return 'react';
          if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) return 'query';
          return undefined;
        },
      },
    },
  },
});
