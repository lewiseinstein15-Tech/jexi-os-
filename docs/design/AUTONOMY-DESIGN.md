# AUTONOMY-DESIGN.md — True Multi-Agent Autonomy in JEXI OS

*Companion to the Goal Engine, Provider Rate Limiter and identity/session
hardening. Written Aug 16, 2026 (Build 80).*

---

## 1. What "autonomous" means here

A **goal** is a real-world outcome the user hands to JEXI ("book me a flight",
"research X then build Y", "plan my trip and email it"). Autonomy is the
degree to which JEXI may act toward that outcome without pausing:

| Level | Behavior |
|---|---|
| `ask` (default) | Plans, runs the graph, pauses at every confirmation exactly like today. |
| `full` | **Preflight questions once** (the agent asks for the details it genuinely needs — dates, cities, budget, accounts), then **runs end-to-end**: confirmations for THIS goal auto-approve, results stream live, final report at the end. Destructive/safety blocks (RiskGuard, Guardrail, EXTERNAL-tier outside the goal) still refuse. |

The user pre-authorizes a goal; the engine never pre-authorizes a capability.

---

## 2. Loop + Graph engineering, applied per subsystem

JEXI's execution model is **typed graphs with bounded feedback loops** — the
LangGraph Supervisor / Reflexion / MetaGPT-SOP pattern family the codebase
already cites. This is what "loop+graph in every part of a task" concretely
means here:

### 2.1 The task graph (Orchestrator, `GraphRunner.js`)
- Typed nodes: `agent | tool | verifier | gate`, routed by `state.outcome`
  via `when()` edges, with a hard `maxSteps` guard so no cycle can run away.
- Node-level auto-retry (`retries`), fallback routing, and parallel fan-out
  with join (`runParallel`).
- `failureHistory` is written on every gate failure and injected into the
  NEXT iteration of the responsible agent — **FAILURE → HISTORY → CORRECT →
  VERIFY**, so each loop round is smarter than the last, not a blind retry.

### 2.2 Coding pipeline (PipelineGraphs `codeGateGraph`)
`Runner → QA gate → (NEEDS FIX → fix → re-run → re-verify, bounded) → accept`.
The QA verdict is a machine-checkable gate (PASS/NEEDS FIX); the fix node
receives the exact QA report; re-verification is honest — a second NEEDS FIX
is shipped as "needs human attention", never looped forever.

### 2.3 Research verification (`researchVerifyGraph`)
`Draft → Verifier → (Revise with the SPECIFIC missing claims → Verifier,
bounded to 1 revision) → final`. The verifier is a strict Critic pass; when
claims are unsupported, the researcher re-enters with the exact flagged
claims as its query — targeted re-search, not a generic re-run.

### 2.4 Review + security (`reviewSecurityGraph`)
`Reviewer → Security gate → (BLOCKED → fix with findings → re-run →
re-review, bounded) → verdict`. Same pattern, two independent LLM passes.

### 2.5 Goal-level loop (GoalEngine, NEW)
`Plan → run → (failed? → retry ONCE with failure + last error injected) →
report`. Skips the retry when the cause is "no API keys / providers down" —
nothing to gain, fails honestly instead.

### 2.6 Tool-calling loop (AgentLoop)
Provider-native `tool_calls` round-trip: model declares call → gated
ToolRuntime executes → result feeds back as `role:'tool'` → loop repeats.
Bounded: `MAX_ITERATIONS = 4`, `MAX_TOOL_CALLS = 8`.

### 2.7 Code debug loop (CodingLoop)
`write → run → observe EXACT error → fix → re-run`, with a machine-checkable
success predicate (exit 0 + no error markers) and a hard 6-attempt budget.

### 2.8 Verification loop (VerificationLoop)
Critique → revise, capped at 2 rounds, skipped for trivial answers.

**The invariant:** every loop in JEXI is *bounded*, *observable* (streamed
`log`/`goal.*` events), and *stateful* (prior failure context feeds the next
round). There is no unbounded retry anywhere.

---

## 3. The Goal Engine flow (NEW)

```
user: "book me a flight"  (autonomy=full)
  │
  ├─ 1. PLANNER   analyzeIntent → travel_booking → [travel, computer-use, navigator, vision, reasoner, memory]
  │
  ├─ 2. PREFLIGHT askWhatItNeeds → ONE LLM call → structured questions
  │     (zod-validated, max 6; LLM down → no questions, never blocks)
  │
  ├─ 3. ASK       → "What city are you departing from? What date? Budget?"
  │     goal parks (status=need-info, /api/goals) — the session waits
  │
  ├─ 4. ANSWER    user types details in chat (or POST /api/goals/:id/info)
  │     → chat handler detects the parked goal → resumes it, answer injected
  │       into state.context.userAnswers
  │
  ├─ 5. EXECUTE   orchestrator.executePlan with autoConfirm → the graph runs
  │     the browser team; confirmations resolve automatically and are
  │     recorded (goal.autoApprovals); RiskGuard/Guardrail still block
  │
  └─ 6. REPORT    final done event: what ran, what was auto-approved,
        what was asked, result summary. Streamed live the whole way.
```

Multiple sessions never mix: parked goals are keyed by session id, chat
history is per-session, and a message in a session with a parked goal is
routed to that goal — never re-planned as a fresh task.

---

## 4. Rate-limit protection for free tiers (NEW)

`ProviderRateLimiter.js` sits in front of EVERY LLM call (both
`generateContent` and `generateWithToolsLoop`):

- **Min interval per provider** (default 1200 ms) — bursts are the #1 way to
  trip free tiers.
- **Per-minute rolling cap** (default 30/min/provider).
- **Global in-flight cap** (default 2) — parallel fan-outs can't spike.
- **Daily budget per provider**, persisted to `DATA_DIR/rate-limits.json`
  (restart-proof). Env: `RATE_DAILY_CAP`.
- **Bounded wait** (20 s max): when a slot can't be acquired in time, the
  router slides to the next healthy provider instead of stalling.
- The existing ProviderRouter still owns *health* (30 s cooldowns after 3
  failures, hourly quarantine of payment-gated providers); the limiter owns
  *prevention*. Together: no burst, no 429 storm, no dead provider loop.

Live view: `GET /api/rate/status`.

## 5. Identity, always (NEW endpoint + verified wiring)

`GET /api/identity` (open, no key needed) returns name (**JEXI OS**), creator
(**Lewis Einstein**), live capability/limitation lists generated from the
actual registries (251 agents / 507 skills / 177 tools as of Build 80), and
the deterministic plain-text `answer`. The same identity block is embedded in
every system prompt (SIMPLE path, worker path, orchestrated path) — verified
by `test-identity.js`.

## 6. Conversation isolation (NEW)

- Session ids sanitized (`[A-Za-z0-9._-]`, ≤64) — crafted headers can't forge
  odd keys.
- Every request touches a session registry; `GET /api/sessions` shows which
  conversations exist and when they were active — proving history is never
  mixed (covered by `test-api-surface.js`).

## 7. Environment

| Var | Default | Meaning |
|---|---|---|
| `RATE_MIN_INTERVAL_MS` | 1200 | min gap between calls to one provider |
| `RATE_MAX_PER_MINUTE` | 30 | rolling per-minute cap per provider |
| `RATE_MAX_INFLIGHT` | 2 | global concurrent LLM calls |
| `RATE_DAILY_CAP` | 0 (off) | daily cap per provider (persisted) |
| `RATE_MAX_WAIT_MS` | 20000 | max wait for a slot before sliding |

## 8. Honest limits of autonomy

- JEXI can only act where she has real engines + keys: no keys → no research,
  coding or booking; she says so and fails honestly (goal retry is skipped).
- "Full" autonomy still refuses: RiskGuard HIGH-risk calls, Guardrail
  injection/tool-abuse signals, EXTERNAL-tier actions outside the goal's
  pre-authorization, and anything requiring credentials she doesn't have.
- Browser-based booking needs the Computer-Use agent's environment
  (Playwright/desktop); on hosts without it, the travel team plans and
  researches but cannot complete the checkout.
