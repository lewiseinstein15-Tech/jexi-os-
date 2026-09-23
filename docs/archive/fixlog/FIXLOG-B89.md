# FIXLOG-B89.md — Do Anything Agent (free-form autonomous task agent)

Build 89 (Aug 16, 2026) — "not just booking — all kinds of things an AI
agent should do."

## What was added

- **DoAnythingAgent (`server/src/services/DoAnythingAgent.js`)** — a
  general-purpose agent loop for ANY task that doesn't fit a fixed pipeline:
  - **PLAN**: an LLM picks concrete steps from a curated 28-tool catalog
    (web search, deep-read, news, browser drive, vision, video, memory,
    knowledge, code, data, connectors, MCP…) — `{tool, args, why}`, bounded
    to 10 steps, strict-JSON schema-validated.
  - **ACT**: every step runs through the **gated ToolRuntime** — the same
    permission profiles, RiskGuard and EXTERNAL-approval rules as everything
    else. External steps are reported as "needs approval" and skipped, never
    silently run; blocked steps are reported.
  - **VERIFY + REPAIR (bounded)**: when a step fails outright, an LLM pass
    checks completion, a repair round adds 1-3 targeted steps (max 2 rounds),
    then re-verifies. A clean run skips the extra LLM call (token economy).
  - **REPORT**: structured `{success, summary, statistics}` → the notifier
    (in-app + email + FCM/web push) and the live job stream (`do.start`,
    `do.plan`, `do.step`, `do.step-result`, `do.repair`, `do.done`).
- **Durable jobs**: `enqueueDoAnything()` — runs on the same queue as goals
  (restart-safe, Redis mirror, terminal reporting), `kind: 'doanything'`
  surfaced in `/api/goals`.
- **Chat commands**: `/do <task>` and `/anything <task>` start a Do Anything
  job and stream it live.
- `GoalJobQueue` public records now include `kind`.

## Verification

- New suite `test-do-anything.js` — **18 assertions** (all LLM/tools mocked):
  happy path plan→act→report, failure→verify→repair→success, approval steps
  skipped not run, risk-guard blocks respected, no-keys honest failure,
  malformed plan no-crash. Wired into `npm test`.
- 22-suite sweep green on Node 22 · lint 0 · live e2e: `/do …` streams
  `do.start` and reports honestly without keys.
