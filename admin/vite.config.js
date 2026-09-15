import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    proxy: {
      '/api': {
        target: process.env.HUFE_API_PROXY || 'http://127.0.0.1:8787',
        changeOrigin: true
      },
      '/health': {
        target: process.env.HUFE_API_PROXY || 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
})
