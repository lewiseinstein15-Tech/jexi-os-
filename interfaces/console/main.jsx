import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import Shell from '../ui/web/console/shell/Shell.jsx'
import './index.css'
import './jexi-theme.css' // FINAL — visual system layer (fonts, flat reskin, a11y)
import 'katex/dist/katex.min.css' // B151 — KaTeX math rendering (bundled)
import '../ui/web/console/shell/tokens.css'
import '../ui/web/console/shell/shell.css'
// ui-rebuild-premium — loaded AFTER the legacy tokens/shell styles so the
// premium layer wins the cascade at equal specificity (same .jx- class
// namespace is intentionally reused by the premium shell).
import '../ui/web/console/shell/tokens-premium.css'
import '../ui/web/console/shell/premium.css'
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

// phase-30(H-fix) — the Phase 24 shell (Chat / Settings / Work Graph) is the
// default boot. Only a deliberate #classic mounts the legacy console. The
// shell is mounted exactly as its standalone entry does
// (ui/web/console/shell/main.jsx: no StrictMode) because the Phase 16 chat
// mount owns its own React root and StrictMode's double-effect would unmount
// that root synchronously mid-render. Legacy keeps StrictMode unchanged.
const root = ReactDOM.createRoot(document.getElementById('root'))
if (window.location.hash === '#classic') {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
} else {
  root.render(<Shell />)
}
