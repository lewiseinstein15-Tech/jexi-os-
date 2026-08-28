import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import 'katex/dist/katex.min.css' // B151 — KaTeX math rendering (bundled)
import { setupPushSubscription } from './utils/pushSubscribe'
import { setupFcm, armFcmForegroundRetry } from './utils/fcmSetup'
import { apply as applyOfficialBrand } from './brand/official'

// B160 — dsh client/ui-brand-official: fill the shipped brand slots
// (sidebar.brand.mark/name + conversation.hero.brand.mark) at boot.
applyOfficialBrand()

// B84 — register for Web Push (notifications even when the app is closed).
// B86/B87 — register the APK's FCM token (closed-app push on the installed
// app), with retries + foreground re-registration + on-device diagnostics.
// Both are best-effort: unsupported browsers / denied permission silently skip.
window.addEventListener('load', () => {
  // B153 — native APK: remove any previously-registered service worker and
  // its caches once (defence in depth against stale cached bundles).
  try {
    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) {
      if ('caches' in window) caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).catch(() => {})
      if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {})
    }
  } catch (e) { /* best-effort */ }
  setupPushSubscription().catch(() => {})
  setupFcm().catch(() => {})
  armFcmForegroundRetry()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
