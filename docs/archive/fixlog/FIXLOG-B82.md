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

---

## B82-fix (same day): scheduled goals were parking forever — unattended mode

**Reported:** a 5-minute scheduled goal with Full autonomy never completed
and no email arrived.

**Root cause (verified on the live deployment):** scheduled goals with
`autonomy: 'full'` ran the preflight question pass — but there is no human to
answer an unattended scheduled run, so the job parked in `need-info`
permanently (`session: scheduler:...`, 6 unanswered questions) and never
reached a terminal state → no notification, no email.

**Fix:**
- `GoalEngine.startGoal(..., { unattended })`: scheduled/background runs SKIP
  the question pass entirely and ALWAYS auto-approve confirmations.
- `GoalJobQueue`: jobs carry `unattended`; the worker AUTO-HEALS any
  scheduler-sourced job stuck in `need-info` by resuming it with
  "use defaults" (at boot AND every worker loop) — heals pre-fix jobs,
  including the one on the live instance, after deploy.
- `TaskScheduler`: goal schedules enqueue with `unattended: true`.
- Preflight prompt tightened: max 3 questions, blocking facts only.

**Verification:** goal-engine 28/28, goal-jobs 23/23, sweep 16 suites green,
lint 0 errors. Live e2e: scheduled goal (full) → run-now → `status: done`,
`infoRequests: []`, real news summary produced.
