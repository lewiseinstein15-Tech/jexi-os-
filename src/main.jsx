import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { setupPushSubscription } from './utils/pushSubscribe'

// B84 — register for Web Push (notifications even when the app is closed).
// Best-effort: unsupported browsers / denied permission silently skip.
window.addEventListener('load', () => {
  setupPushSubscription().catch(() => {})
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
