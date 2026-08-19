import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import 'katex/dist/katex.min.css' // B151 — KaTeX math rendering (bundled)
import { setupPushSubscription } from './utils/pushSubscribe'
import { setupFcm, armFcmForegroundRetry } from './utils/fcmSetup'

// B84 — register for Web Push (notifications even when the app is closed).
// B86/B87 — register the APK's FCM token (closed-app push on the installed
// app), with retries + foreground re-registration + on-device diagnostics.
// Both are best-effort: unsupported browsers / denied permission silently skip.
window.addEventListener('load', () => {
  setupPushSubscription().catch(() => {})
  setupFcm().catch(() => {})
  armFcmForegroundRetry()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
