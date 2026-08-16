import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { setupPushSubscription } from './utils/pushSubscribe'
import { setupFcm } from './utils/fcmSetup'

// B84 — register for Web Push (notifications even when the app is closed).
// B86 — register the APK's FCM token (closed-app push on the installed app).
// Both are best-effort: unsupported browsers / denied permission silently skip.
window.addEventListener('load', () => {
  setupPushSubscription().catch(() => {})
  setupFcm().catch(() => {})
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
