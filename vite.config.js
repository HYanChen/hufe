import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import { developmentApiProxy } from './config/devProxy.js'

export default defineConfig({
  plugins: [uni()],
  server: { proxy: developmentApiProxy(process.env) }
})
