import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  root: 'app',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'app/index.html'),
        demo: resolve(__dirname, 'app/demo.html'),
        demo2: resolve(__dirname, 'app/demo2.html'),
        install: resolve(__dirname, 'app/install.html'),
        docs: resolve(__dirname, 'app/docs.html'),
        embed: resolve(__dirname, 'app/embed.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5374,
    proxy: {
      '/api': 'http://127.0.0.1:4783',
      '/cdn': 'http://127.0.0.1:4783',
      '/u': 'http://127.0.0.1:4783',
      '/embed': 'http://127.0.0.1:4783',
      '/manifest.json': 'http://127.0.0.1:4783',
      '/health': 'http://127.0.0.1:4783',
      '/ws': {
        target: 'ws://127.0.0.1:4783',
        ws: true,
      },
    },
  },
})
