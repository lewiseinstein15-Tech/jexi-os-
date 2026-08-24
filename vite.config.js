import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base: works on Vercel (root) and GitHub Pages (subpath)
  base: './',
  // Pin the dependency scanner to the real app entry. Without this, Vite
  // auto-discovers EVERY index.html in the project — including the COMPILED
  // Android bundle at android/app/src/main/assets/public/index.html — and
  // crashes the dev server trying to resolve imports inside that built file
  // ("@emotion/is-prop-valid could not be resolved").
  optimizeDeps: {
    entries: 'index.html',
  },
  // Conservative JS target so the bundle PARSES on older Android WebViews
  // (the app ships as an APK with minSdk 24 = Android 7.0+, whose WebView can
  // be far older than the Vite default of Chrome 87+). Transpiles `??`, `?.()`
  // etc. down to ES2017 syntax; BigInt literals were removed from the source
  // because esbuild cannot down-level them. No behavior change on modern
  // browsers — they just get slightly more verbose code.
  build: {
    target: 'es2017',
  },
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
