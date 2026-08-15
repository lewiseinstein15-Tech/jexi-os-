# FIXLOG-B70 — Backend lock readiness + app update flow

**Date:** 2026-08-15
**Standard:** every change is real code + a real passing test/build.

Context: Lewis chose the literal value `com/0006/25` as the `JEXI_API_KEY` that locks
the backend (every `/api/*` call except the open/read-only class requires the
`x-jexi-key` header to match, constant-time). Two gaps had to close so the lock
doesn't break the app-update channel and the lock-recovery UX.

## Change 1 — APK update proxy stays open when the backend is locked

**Before:** the gate (`server/index.js` `OPEN_PATHS`) listed only `/api/health`,
`/api/settings/status`, `/api/metrics`. `/api/update/apk` (the in-app update channel
that streams the newest APK from GitHub's public release) was gated — a freshly
installed app with no access key yet could not check/download the update.

**After:** `OPEN_PATHS` includes `'/api/update/apk'` — read-only infra serving a
public GitHub release, same open class as `/api/health`.

```
$ cd server && npm test → EXIT=0 (full suite)
```

## Change 2 — Task board auto-refreshes when the access key is set

**Before:** `onAccessKeyChange` existed in `src/utils/helpers.js` but nothing
listened to it. After pasting the key in Settings → System, the app kept showing
401-era empty/error states until a manual reload.

**After:** `src/hooks/useTasks.js` subscribes: `useEffect(() => onAccessKeyChange(() => refresh()), [refresh])`
— the moment the key is saved, the task list refetches and recovers without a reload.

```
$ npm run build → EXIT=0 (✓ built in 18.50s)
```

## How the lock is activated (user action — Render dashboard)

The backend runs on the user's Render account (`jexi-os-brain`); the env var is set
there, same place `REDIS_URL` was set:

1. Render dashboard → jexi-os-brain → **Environment**
2. Add: `JEXI_API_KEY` = `com/0006/25` (per Lewis's explicit instruction)
3. Deploy
4. In the app (web + Android): **Settings → System → JEXI Access Key** → paste
   `com/0006/25` → the task board (and everything else) recovers automatically.

## Change 3 — Update detection no longer depends on the phone's GitHub API quota

**Problem:** the Android app's update banner compares its baked-in build tag
against `api.github.com/releases/latest` directly from the phone. Unauthenticated
GitHub API is capped at 60 req/hr per IP — easy for a phone to exhaust — and when
that fails the check silently shows no banner (the user did not receive build #69).

**After:**
- `server/index.js` — new open `GET /api/update/version`: server-side GitHub fetch
  with a proper User-Agent, 60s cache, returns `{ tag, number, date, notes }`.
  Open class (no secrets, no AI spend), so it works even when the backend is locked.
- `src/hooks/useUpdateChecker.js` — checks GitHub API first, **falls back to the
  backend probe** on any failure (rate limit, offline api.github.com, 403). A
  fresh check runs on app open, on focus, and every 10 min.

```
$ cd server && node --check index.js && node test-connectors.js → EXIT=0
$ npm run build → EXIT=0
```

## Verification plan (post-deploy, on request)

- `GET /api/memory` without the key → **401**
- `GET /api/memory` with `x-jexi-key: com/0006/25` → **200**
- `GET /api/health`, `/api/update/apk` → stay **open** (infra class)
- Connector webhooks (GitHub/Resend) → stay open (mounted outside `/api`)
