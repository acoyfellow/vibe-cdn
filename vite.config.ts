import { defineConfig } from 'vite'

export default defineConfig({
  root: 'app',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:9787',
      '/assets': 'http://127.0.0.1:9787',
      '/manifest.json': 'http://127.0.0.1:9787',
      '/health': 'http://127.0.0.1:9787',
      '/ws': {
        target: 'ws://127.0.0.1:9787',
        ws: true,
      },
    },
  },
})
