# FIXLOG-B82.md — Scheduled Goals (JEXI runs proactively)

Build 82 (Aug 16, 2026) — the scheduler now launches durable autonomous GOALS,
not just old-style tasks. JEXI runs on her own schedule and reports when done
(notification + email via the Build 81 notifier).

## What was added

### TaskScheduler: `kind: 'goal'` + `dailyAt` cadence
- `create()` accepts `kind: 'task' | 'goal'` (default task, back-compat),
  `autonomy: 'ask' | 'full'`, and a new **`dailyAt: 'HH:MM'`** cadence
  ("every morning at 8:00", server local time) alongside the existing
  `everySeconds` intervals.
- **Firing a goal schedule enqueues a durable GOAL JOB** (GoalJobQueue):
  preflight questions, auto-approvals, restart survival, completion
  notification + email report all come for free — no stacking (skips a tick
  while the previous goal job is queued/running/need-info), catch-up after
  downtime, pause/resume/run-now/remove, persistence to
  `DATA_DIR/schedules.json` — all unchanged for legacy task schedules.
- Schedules record `lastJobId`, `lastStatus`, `lastSummary` (watched to
  completion, bounded 15 min).
- **Bug fixed (caught by the new tests):** a missing cadence previously
  silently became "every 1 second" (`Math.max(1, …)` ran before validation).
  Now rejected with a clear error.

### API + UI
- `POST /api/schedules` accepts `kind`, `autonomy`, `dailyAt`.
- Goals screen: **Scheduled goals** section — goal text, cadence (every 5 min /
  hourly / daily / daily at HH:MM), autonomy toggle, and a live list with
  pause / resume / run-now / delete, next-run time, run count + last status.

## Verification

- New suite `test-goal-schedules.js` — **26 assertions**: cadence validation
  (incl. the every-1s bug), dailyAt next-run math (lands on HH:MM, future),
  tick enqueues a durable goal job with the right query + autonomy,
  no-stacking while running, pause/resume/run-now/remove, publicSchedule
  shape, legacy task schedules unchanged.
- Full sweep on Node 22: 17 suites green (goal-jobs 20/20, goal-notify 17/17,
  goal-engine 21/21, scheduler legacy ✓, security 52/52, rate-limiter 13/13,
  identity 17/17, memory-persistence 37/37, b78 45/45, api-surface 18/18,
  planner-routing, worker-router, risk-guard, mcp, workspace).
- `npm run lint`: 0 errors · frontend `vite build` green.
- Live e2e: POST /api/schedules (kind goal, full autonomy) → run-now →
  durable goal job created (`give me a tech news roundup`, autonomy full),
  schedule records lastJobId/lastStatus/runCount.
