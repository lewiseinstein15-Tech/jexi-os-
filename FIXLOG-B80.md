# FIXLOG-B80.md — Phase 2: Durable Background Goals · Atomic Memory · Browser SSRF · Lint

Build 80 (Aug 16, 2026) — the Phase-2 architecture pass. Everything verified
locally on Node 22 (CI runtime) and by the GitHub Actions CI chain.

---

## 1. Goals are now durable background jobs (GoalJobQueue)

**Problem:** goals ran inside the HTTP request. A proxy drop, app background,
or host restart killed the run mid-flight (the old 15-min deadline + result
polling were patches for exactly this).

**Fix:**
- `POST /api/goals` returns `{ ok, jobId }` immediately (202). A single
  background worker runs the GoalEngine; jobs + their event logs persist to
  `DATA_DIR/goal-jobs.json`.
- `GET /api/goals/:id/stream` replays the persisted NDJSON log, then streams
  live events until the job finishes — a client can reconnect at any time
  and never loses progress.
- **Restart survival:** on boot, `queued` jobs re-run; `running` jobs are
  honestly marked interrupted (ProcessManager pattern); `need-info` jobs stay
  parked and can still be answered after a restart (GoalEngine resumes from a
  persisted fallback record).
- **Chat integration:** `/goal <text>` (or `goal: <text>`) starts an
  autonomous goal right from chat and streams it live; a message sent while
  a goal in that session is parked answers its questions (routed through the
  job queue, never re-planned).

## 2. Atomic memory writes (MemoryManager)

**Problem:** `memory.json` was written with plain `writeFileSync` — a crash
mid-write could corrupt the file; readers could see half-written content.

**Fix:** all four write sites now go through one helper: write a temp file →
`fsync` → atomic `rename` over the real file. A crash can never corrupt the
memory core.

## 3. Browser SSRF guard (DesktopManager.goto)

**Problem:** the browser agent navigated to any URL the LLM chose — a
prompt-injected agent could be sent to `169.254.169.254` (cloud metadata) or
internal ranges.

**Fix:** `goto` now blocks private / link-local / metadata targets via the
existing `isSSRF` guard, while **loopback stays allowed** (JEXI legitimately
previews locally-built apps at `http://localhost`). Set
`DESKTOP_ALLOW_PRIVATE=1` to lift the block.

## 4. ESLint wired into CI — and it caught a real bug

- New `eslint.config.js` (flat config): **error-level rules only for real
  bugs** (`no-undef`, redeclaration, unsafe patterns), style noise as
  warnings. `npm run lint` runs in the CI backend job.
- **Bug found on first run:** `Orchestrator.N.research` referenced
  `state.context.retryWithClaims` without destructuring `state` — every
  research task crashed with `state is not defined` *before searching*
  (verified live: `success: false, error: state is not defined`). Fixed;
  research now runs (verified: real web search, graceful degraded answer
  without keys). The B51 P5 verification-follow-up path is alive for the
  first time.

## 5. Everything else in this build

- `GET /api/goals/:id/stream`, `POST /api/goals/:id/info` (answers a parked
  goal, streams the resumed run), `GET /api/goals` + `/:id` now read durable
  job records.
- New suite `test-goal-jobs.js` (20 assertions) wired into `npm test`.
- AUTONOMY-DESIGN.md updated (Phase 2: job queue, durability, lint).

## Verification

- New: test-goal-jobs 20/20 · goal-engine 21/21 · rate-limiter 13/13 ·
  identity 17/17 · security 52/52 — all green on Node 22.
- Regressions on Node 22: planner-routing (incl. travel), worker-router 37/37,
  api-surface 18/18, b78 45/45, workspace 13/13, risk-guard 34/34, mcp,
  llm-models — green. Frontend `vite build` green. `npm run lint`: 0 errors.
- GitHub Actions on the merged commit: CI ✅ · Deploy Frontend ✅ · APK ✅.
