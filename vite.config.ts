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
      '/api': 'http://127.0.0.1:8789',
      '/assets': 'http://127.0.0.1:8789',
      '/manifest.json': 'http://127.0.0.1:8789',
      '/health': 'http://127.0.0.1:8789',
      '/ws': {
        target: 'ws://127.0.0.1:8789',
        ws: true,
      },
    },
  },
})
