import { sveltekit } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['argon2-browser'],  // WASM — don't pre-bundle
  },
  build: {
    target: 'es2022',  // Supports top-level await needed by WASM modules
    rollupOptions: {
      output: {
        // Generate stable hashes for SRI verification
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
