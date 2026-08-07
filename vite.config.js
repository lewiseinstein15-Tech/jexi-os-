import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/jexi-os-/',
  server: {
    host: true,
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3002',
      '/desktop-api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/desktop-api/, '/api')
      }
    }
  }
})
