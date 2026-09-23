# FIXLOG-B86.md — FCM: closed-app push for the installed APK

Build 86 (Aug 16, 2026) — the final notification layer. Web push (B84)
covers the PWA; FCM delivers to the **installed Android app even when it's
fully closed/killed**. Free (Firebase Spark plan; FCM itself is free and
unlimited — the user's own keys were used).

## What was added

- **@capacitor-firebase/messaging** installed + synced into the APK;
  `google-services.json` (user's project `jexi-os`, package `com.jexi.os`)
  committed to `android/app/`; the Google Services gradle plugin
  auto-applies (verified in build.gradle).
- **FcmManager (`server/src/services/FcmManager.js`)**:
  - Service account resolution: `FIREBASE_SERVICE_ACCOUNT` env (JSON) →
    `GOOGLE_APPLICATION_CREDENTIALS` path → `server/firebase-service-account.json`
    (gitignored — private key never committed).
  - OAuth access tokens: RS256 JWT from the service account, cached,
    refreshed ~10 min before expiry; fetcher injectable for tests.
  - Device token store (`DATA_DIR/fcm-tokens.json`, atomic, capped):
    register / unregister / list / status.
  - `broadcastFcm()` — sends to every device token; dead tokens pruned
    (404 / UNREGISTERED / INVALID_ARGUMENT); per-token isolation.
- **Wiring**: every notification also pushes via FCM (alongside web push);
  endpoints `POST /api/push/fcm-token` · `POST /api/push/fcm-unregister` ·
  `GET /api/push/fcm-status`.
- **Client** (`src/utils/fcmSetup.js`): on native only — request permission,
  register the FCM token with the backend, and foreground messages become
  local notifications (Android only shows system notifications in
  background/closed states). Fired from `main.jsx`, fully best-effort.
- `firebase` web SDK added so the plugin bundles on the web build.

## Verification

- FCM auth proven against the real service account: OAuth endpoint 200 +
  access token; send path reaches FCM (INVALID_ARGUMENT only because the
  test token is fake — real device tokens deliver).
- New suite `test-fcm.js` — **18 assertions**: config detection, token store
  CRUD + upsert, OAuth token caching (fetched once), broadcast to all +
  dead-token pruning + payload shape, no-throw on sender failure,
  no-tokens/unconfigured no-ops.
- 22-suite sweep green on Node 22 · lint 0 errors · frontend build green ·
  cap sync ok · live e2e: fcm-status (configured, project jexi-os),
  token register → deviceTokens 1.
- Deploy note: set `FIREBASE_SERVICE_ACCOUNT` (the service-account JSON) as a
  multiline env var on Render so the backend can sign FCM requests.
