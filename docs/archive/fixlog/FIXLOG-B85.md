# FIXLOG-B85.md — Durable Chat: long chat tasks survive restarts

Build 85 (Aug 16, 2026) — chat joins goals on the durable background queue.

## What was added

- `GoalJobQueue.enqueueChat({ query, session })` — chat tasks run as durable
  background jobs: persisted to disk + Redis mirror, restart-safe, live NDJSON
  stream, terminal notification (in-app + email + web push) via the notifier.
- **New endpoints**: `POST /api/chat/async` (202 + jobId immediately) and
  `GET /api/chat/async/:id/stream` (replay + live).
- **Chat executor** (index.js): runs the exact same Planner → SIMPLE/COMPLEX
  pipeline as sync chat; on a confirmation pause it parks the job with the
  full RunState saved (SessionStore) — a reply in `/api/chat` resumes it with
  `confirmed: true`, same as the sync resume path.
- **Interactive-by-design**: chat jobs are excluded from the scheduled-goal
  auto-heal (they must wait for the human); the heal now checks `kind`.
- `GoalNotifier` labels chat jobs "✅ Task complete" (vs "Goal complete").
- Bug fixed while wiring: the worker's goal-only post-chain could clobber
  chat job statuses — chat jobs now fully handled in their own branch.

## Verification

- New suite `test-chat-jobs.js` — **14 assertions**: run→done with events +
  result, failure recorded, pause→need-info→answer→resume (executor receives
  the answer), notifier fires for chat jobs, goal jobs unaffected.
- 21-suite sweep green on Node 22 · lint 0 errors · live e2e: enqueue → 202 →
  stream replays chat.started + planner logs → job running.
