# FIXLOG-B81.md — Goal Completion Notifications + Email Reports

Build 81 (Aug 16, 2026) — "reply when done": when a background goal reaches a
terminal state, JEXI tells the user like a real autonomous agent instead of
only streaming to an open tab.

## What was added

### GoalNotifier (`server/src/services/GoalNotifier.js`)
- **Always** — an in-app notification (Notification Center bell): title
  (`✅ Goal complete: <goal>` / `⚠️ Goal failed: <goal>`), summary body, kind
  (success/error), link to the goal's live stream.
- **Optionally** — an email report when a recipient is configured
  (`GOAL_REPORT_EMAIL` env var, or Settings → **Email goal reports to**) and
  the Email connector key is present (`RESEND_API_KEY`). Plain-text report:
  goal, status, autonomy, attempts, auto-approved confirmations, the summary
  (markdown stripped to plain text), and the live-stream link.
- **Dedupes per job id** — a job can never notify twice (verified by tests).
- **Never throws** — a notification or email failure can never break the goal
  pipeline (async best-effort email).

### Wiring
- `GoalJobQueue` worker now calls an injectable `setGoalNotifier(...)` at
  every terminal state (done / failed; `need-info` stays silent — the user is
  actively chatting at that point).
- `index.js` wires the real notifier + the real email `callConnector`.
- Settings panel: new **EMAIL GOAL REPORTS TO** input (saved via `/api/settings`,
  env var wins at send time). `.env.example` documents `GOAL_REPORT_EMAIL`.

## Verification

- New suite `test-goal-notify.js` — **17 assertions**: in-app notification on
  completion, kind correct, email send attempted when recipient set (mock
  connector: to/subject/plain-text body verified), dedupe (no second email,
  no second notification), failed goals notify with error kind + reason,
  no-email-without-recipient no-throw, end-to-end queued job → notification.
  Wired into `npm test`.
- Full sweep on Node 22: 15 suites green (incl. goal-jobs 20/20, goal-engine
  21/21, notifications-models 20/20, api-surface, b78, security 52/52,
  rate-limiter, identity, memory-persistence 37/37, planner-routing,
  worker-router, risk-guard, mcp, workspace).
- `npm run lint`: 0 errors. Frontend `vite build` green.
- Live e2e: `POST /api/goals` → 202 → job completes → notification appears
  (`✅ Goal complete: summarize the news for me`), unread count 1.
