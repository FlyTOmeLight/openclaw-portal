import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/portal/',
  plugins: [vue()],
  server: {
    proxy: {
      '/portal/api/chat/ws': { target: 'ws://127.0.0.1:18800', ws: true, rewrite: (path) => path.replace('/portal', '') },
      '/portal/api/ws': { target: 'ws://127.0.0.1:18800', ws: true, rewrite: (path) => path.replace('/portal', '') },
      '/portal/api/terminal/ws': { target: 'ws://127.0.0.1:18800', ws: true, rewrite: (path) => path.replace('/portal', '') },
      '/portal/api/activity/ws': { target: 'ws://127.0.0.1:18800', ws: true, rewrite: (path) => path.replace('/portal', '') },
      '/portal/api': { target: 'http://127.0.0.1:18800', rewrite: (path) => path.replace('/portal', '') },
      '/api/chat/ws': { target: 'ws://127.0.0.1:18800', ws: true },
      '/api/ws': { target: 'ws://127.0.0.1:18800', ws: true },
      '/api/terminal/ws': { target: 'ws://127.0.0.1:18800', ws: true },
      '/api/activity/ws': { target: 'ws://127.0.0.1:18800', ws: true },
      '/api': 'http://127.0.0.1:18800',
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
          'vendor-ui': ['naive-ui'],
          'vendor-markdown': ['marked', 'dompurify'],
          'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit'],
          'vendor-qrcode': ['qrcode'],
          'vendor-cron': ['cron-parser'],
        },
      },
    },
  },
})
