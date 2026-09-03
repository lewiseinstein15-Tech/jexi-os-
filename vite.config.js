import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// B158 — bake a per-build stamp into <meta name="jexi-build">. The inline
// bootstrap in index.html compares it with the last-seen stamp and wipes
// caches + Service Workers when it changes, so a stale bundle can never
// survive an update. 'dev' never triggers a wipe (local dev reloads are free).
function jexiBuildStamp() {
  const stamp =
    process.env.VITE_BUILD_SHA ||
    process.env.VITE_APP_VERSION ||
    (process.env.NODE_ENV === 'production' ? String(Date.now()) : 'dev')
  return {
    name: 'jexi-build-stamp',
    transformIndexHtml(html) {
      return html.replace('<meta name="jexi-build" content="dev" />', `<meta name="jexi-build" content="${stamp}" />`)
    },
  }
}

export default defineConfig({
  plugins: [react(), jexiBuildStamp()],
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
    // B197 — the dev server is often reached through a tunnelled/proxied
    // preview host (e.g. sandboxed preview domains, Codespaces). Vite's host
    // check 403s those by default; allow any host in DEV (production deploys
    // are static files — this setting never ships).
    allowedHosts: true,
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
