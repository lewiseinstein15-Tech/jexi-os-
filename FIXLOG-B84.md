# FIXLOG-B84.md — Web Push: JEXI notifies you even when the app is closed

Build 84 (Aug 16, 2026) — closes the notification loop. Local phone
notifications (B83) fire while the app's JS runtime is alive; Web Push adds
delivery when the app is **closed** — on the hosted PWA (GitHub Pages) and
any modern browser, including Android Chrome PWA on the phone.

## What was added

### PushManager (`server/src/services/PushManager.js`)
- **VAPID keys** — auto-generated on first boot, persisted to
  `DATA_DIR/vapid.json`. No external accounts, no setup, free. Public key
  exposed via `GET /api/push/vapid-key` (open, read-only); private key never
  leaves the server.
- **Subscription store** — `DATA_DIR/push-subscriptions.json` (atomic
  writes): register / upsert / unsubscribe / list; only `https://` endpoints
  accepted; capped (30) with pruning.
- **broadcastPush(title, body, link)** — sends to every registered device via
  the `web-push` library (VAPID-signed, 24h TTL so a phone that was off gets
  the notification when it returns); **dead subscriptions (404/410) pruned
  automatically**; per-device try/catch so one bad device never blocks the
  rest. Sender injectable for tests.

### Wiring
- `NotificationCenter.setNotifyBroadcaster()` — every notification (goal
  complete/failed, scheduled mission, anything) now ALSO pushes to all
  registered devices, best-effort (a push failure never breaks notify).
- Endpoints: `GET /api/push/vapid-key` (open) · `POST /api/push/subscribe` ·
  `POST /api/push/unsubscribe` · `GET /api/push/subscriptions` (count).

### Client
- `public/sw.js` — service worker: shows the push notification (JEXI icon,
  body, tap → opens the link / the app), claims clients on activate.
- `src/utils/pushSubscribe.js` — registers the SW, requests permission,
  subscribes with the backend's VAPID key, stores the subscription server-side.
  Fully best-effort (unsupported browser / HTTP / denied → silently skip;
  local notifications still work).
- `src/main.jsx` — fires setup on window load.

## Verification

- New suite `test-push.js` — **20 assertions**: VAPID key generation/stability,
  subscription validation (http rejected, missing keys rejected, https upsert),
  broadcast to all with payload shape, dead-subscription pruning (410), no-throw
  on sender failure, NotificationCenter broadcaster fires with the same
  notification object and a throwing broadcaster can't break notify.
- 20-suite sweep green on Node 22 · lint 0 errors · frontend build green
  (`dist/sw.js` served) · live e2e: VAPID endpoint, subscribe → count 1,
  unsubscribe → removed.
- Deployment note: GitHub Pages deploys `sw.js` automatically (it lives in
  `public/`); the Express static (Docker) serves it too.
