import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [wasm(), topLevelAwait(), sveltekit()],
  test: {
    alias: {
      'argon2-browser': '/home/vale/_GITHUB/ValentinHerrmann/BlindGrade/frontend/tests/mocks/argon2Mock.ts',
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['argon2-browser'],
    include: ['texlyre-busytex'],
  },
  ssr: {
    external: ['argon2-browser'],
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      external: [/.*\.wasm$/],
      output: {
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
