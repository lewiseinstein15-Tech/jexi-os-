# B211 — CAPABILITY MATRIX (Autonomy Engineering Upgrade)

> Status vocabulary: **SHIPPED** = implemented, wired end-to-end, covered by
> real passing tests. **PARTIAL** = working core with documented limits.
> **NOT BUILT** = honestly absent. Nothing is marked SHIPPED on code
> existence alone; every SHIPPED row cites the tests that prove it.
>
> Verification snapshot: local suites green (B208 89, B209 92, B210 64,
> B211 spine 111, B2 74, B3 57, B4 autonomy 53 = 540 director-lane checks;
> 295 of them B211), CI 5/5, Render live. B223 adds tool discovery (17),
> B224 adds SSE push (10) — full chain 0 ❌.

| # | Spec capability | Status | Evidence (real passing tests) | Notes / honest limits |
|---|---|---|---|---|
| 1 | Persistent Work Graph: items + typed relations (BLOCKS / DISCOVERED_FROM / SUPERSEDES / PRODUCES), survives restart | SHIPPED | `test-b211.js` A (relations, deterministic ready-work, leases, atomic persistence, restart recovery) | Deterministic order: priority desc → createdAt asc; leases TTL 10 min |
| 2 | Mission state machine (CREATED…CANCELLED, validated transitions) | SHIPPED | `test-b211.js` B (illegal transitions throw) | PLANNING↔AWAITING_INPUT added for the risk gate (B2) |
| 3 | Mission persistence + budgets (items/failures/wall-clock/replans/discovery) | SHIPPED | `test-b211.js` B + budget tests | maxItems 24, maxFailures 8, 30-min window, 1 replan, 6 discovery rounds (per mission, overridable) |
| 4 | Ready-work engine (deterministic dependency resolution) | SHIPPED | `test-b211.js` A + dependency-order in `tests/autonomy/long-horizon-mission.js` | Parallel batches (MAX_PARALLEL=3), deadlock fails honestly |
| 5 | "Continue." reconstructs + resumes without re-asking | SHIPPED | `test-b211.js` J; `tests/autonomy/browser-disconnect.js` 1 | No re-planning on resume; in-flight results kept |
| 6 | Discovered work (EXECUTE_NOW / QUEUE / DELEGATE / DEFER / IGNORE_WITH_REASON, lineage) | SHIPPED | `test-b211.js` D (### DISCOVERED ingestion, dupe-merge, budget deferral) | Classification by the discovering employee, bounded by budget |
| 7 | Mid-mission steering (impact → invalidate affected only → replan) | SHIPPED | `test-b211.js` F (done work never invalidated; SUPERSEDES lineage) | Impact analysis is LLM-driven; unavailable lane defers the steering honestly |
| 8 | Mission checkpoints (every mutation persisted atomically) | SHIPPED | `tests/autonomy/backend-restart.js` (SIGKILL → fresh process → resume, DONE never redone) | tmp+rename writes; events append-only with chained ids |
| 9 | User controls: pause / resume / cancel / retry / skip / approve | SHIPPED | `test-b211.js` H (controls incl. retry re-opening FAILED), B2 risk-gate approval | Exposed via `/api/missions/:id/control` + chat |
| 10 | Complexity/risk analyzer → execution depth (SIMPLE→LONG_HORIZON) | SHIPPED | `test-b211b2.js` A/B (heuristics floor, LLM refinement, decidedBy honesty) | Heuristics never inflate (uncertainty maps down) |
| 11 | CRITICAL-risk approval gate (nothing runs before approval) | SHIPPED | `test-b211b2.js` I/J (gate → approve; gate → change steers the plan) | Gate reasons cite the objective's actual words |
| 12 | Imagination Engine: bounded counterfactual strategy search | SHIPPED | `test-b211b2.js` C (≤3 branches, ≤2 LLM calls, CREATED→SELECTED/REJECTED with reasons) | Hard budgets; single deterministic fallback judge when the judge lane is down |
| 13 | SIMULATION_UNAVAILABLE honesty (never fake a simulation) | SHIPPED | `test-b211b2.js` C/H; `tests/autonomy/failure-injection.js` 5 | Unavailable pass is recorded with the real reason and skipped, not retried |
| 14 | PREDICTED vs ACTUAL (deviation + lesson at mission end) | SHIPPED | `test-b211b2.js` D/F (review event + persisted lesson from real numbers) | Deterministic comparison; lesson feeds the store |
| 15 | Operational learning (failure → cause → strategy → lesson, retrievable) | SHIPPED | `test-b211b2.js` E/K; `tests/autonomy/failure-injection.js` 1b/2/6 (lessons reach the NEXT plan prompt) | Token-relevance retrieval, dedupe, 300-entry cap, cross-process persistence |
| 16 | ModelRouter fallback; employee identity ≠ model identity | SHIPPED (B209, reused) | B209 92 checks; `tests/autonomy/failure-injection.js` 1a (injected 429s → MODEL_SWITCHED → delivered) | 9-rung ladder, telemetry-informed |
| 17 | Recovery engine, layered (model-lane → assignment ladder RETRY/REASSIGN/ESCALATE → replan) | SHIPPED | `tests/autonomy/failure-injection.js` 1a/1b/2 | Single-employee staffing cannot REASSIGN (honest: RETRY→ESCALATE) |
| 18 | Verification: ACTION COMPLETED vs OBJECTIVE VERIFIED | SHIPPED | `test-b211.js` (mission verify); B210 64 checks (anti-fabrication gate); `tests/autonomy/long-horizon-mission.js` (verdict grounded in real TEST_* events) | Deterministic acceptance gates (empty/short/refusal/fabricated-execution) run without any model |
| 19 | Artifacts: real files, hashes, relationships; never claim non-existent | SHIPPED | `test-b211.js` artifact tests; `tests/autonomy/long-horizon-mission.js` (files on disk verified independently) | Content-hashed records; subpaths ≤3 levels sanitized; workspace is MISSION-scoped (B4 fix) |
| 20 | ComputerRuntime adapters with capability honesty (local/remote/docker/mock) | SHIPPED (pre-B211 core, reused) | `test-computer-runtime.js` 15 checks; `test-b211b3.js` D (local → COMPUTER_BLOCKED, never faked) | docker honestly "not configured"; env-detected at execution time |
| 21 | Atlas: computer-ops employee (identity, tools, COMPUTER permission) | SHIPPED | `test-b211b3.js` C (identity, staffing, synonyms, permission refusal for others) | Roster override under DATA_DIR; defaults ship Atlas |
| 22 | Browser loop: observe → act → observe → verify (```browser blocks) | SHIPPED | `test-b211b3.js` F (real round-trip: actions execute, observed state feeds the next prompt, bounded 3 rounds/4 actions) | Mirrors the proven B210 ```run loop; per-tool budgets |
| 23 | COMPUTER_* telemetry events (real execution only) | SHIPPED | `test-b211b3.js` F/I (events from session + mission levels) | Frontend renders them; it never invents them |
| 24 | Live computer-use UI panel (real telemetry + real screenshots) | SHIPPED | `test-b211b3.js` (screenshot events carry real saved files); frontend build green | Renders nothing without real computer events; screenshot is a real capture or absent |
| 25 | Chat is a view (browser disconnect changes nothing server-side) | SHIPPED | `tests/autonomy/browser-disconnect.js` (viewer dies mid-stream + dead-on-arrival; replay on reconnect) | Every sendEvent/done is isolated; the persisted record is the source of truth |
| 26 | Backend restart safety (boot recovery, DONE never redone) | SHIPPED | `tests/autonomy/backend-restart.js` (REAL SIGKILL of a child process; fresh process resumes; exactly-one-session proofs) | In-flight items requeue with recorded reason |
| 27 | Long-horizon mission: build + test + fix + verify a full-stack app, unguided | SHIPPED | `tests/autonomy/long-horizon-mission.js` (real fail→fix→pass via real `node --test`; the TEST re-runs the suite independently, trusting nothing) | Model scripted, machinery real — the established harness pattern |
| 28 | Failure-injection suite | SHIPPED | `tests/autonomy/failure-injection.js` (429s, BAD_OUTPUT, lane death, verify-fail correction, tool failure, imagination-down, lessons) | — |
| 29 | Secrets never in prompts/logs/telemetry/UI/artifacts | SHIPPED (standing) | B209/B210 gate tests; command env scrubbing (shellEnv); sanitizeWorkProduct | No new secret surface introduced by B211 |
| 30 | Event-sourcing rule: the frontend never invents operational events | SHIPPED (standing) | B208 89 checks + all B211 events originate server-side | ComputerPanel/TeamLive render only |
| 31 | Tool discovery: objective → capability → tool, risk + verification metadata, honest gaps (Part 20) | SHIPPED | `test-b223.js` (17: registry coverage, B209 risk truth, verification kinds, provenance, allowlist respect, gap honesty, determinism, wiring contracts) | ADDITIVE metadata — team injection unchanged; discovery does not yet compose teams |
| 32 | SSE push for mission events: native replay, bounded 300, heartbeat, ?key auth; polling as fallback (Part 29) | SHIPPED | `test-b224.js` (10: wire format on a real HTTP server, LIVE push without client poll, Last-Event-ID tail-only replay, 404, heartbeat, cleanup, auth + frontend contracts) | Server tails events.jsonl at 1s per open stream; client stretches polls while push is live |

## Honest limitations (not hidden, not converted to PASS)

1. ~~Same-session file rewrite~~ **CLOSED in B212**: a same-name artifact in a later round of the same session is a fix-in-place — rewritten on disk with a FILE_UPDATED event (proven by the employee's own `cat` reading the fixed content back); identical rewrites are no-ops. `test-b212.js`.
2. ~~Mission UI~~ **CLOSED in B212**: `MissionsScreen` — mission control over the real API (list, snapshot, work graph, live event record, pause/resume/cancel/retry, steering, answers for gated missions). Real API only; the frontend invents nothing.
3. ~~Production browser~~ **CLOSED in B212 (live-verified, twice)**: the
   production brain runs the slim deploy image — no Chromium, by design
   (512MB hosts OOM with a browser), `JEXI_NO_BROWSER=1`. Two live missions
   against prod proved the honest chain end-to-end: the first browser
   attempt now emits ONE COMPUTER_BLOCKED with the true reason (before B212
   it burned a round of dead actions and an empty observation — the E2E
   also caught and fixed an always-empty observed title), the employees
   pivot to server-side fetch, and the mission only passes if the
   deliverable is real. Real browser-driven computer use on production
   requires a bigger plan / the full image — an infrastructure decision,
   not a code gap.
4. **Worker pool**: parallel batches per mission loop (3), not a
   cross-mission persistent pool; leases exist in the WorkGraph but one
   runner process per deployment is the current model. Deferred by design.
5. **Imagination lessons** are deterministic (real numbers, templated
   wording) — no LLM narrative polish. Deferred by design.
6. ~~Employee provenance discipline~~ **CLOSED in B213 (live-verified)**:
   browser-method claims now require real COMPUTER_ACT/OBSERVE events
   (deterministic gate — the model cannot override it), Vera's rubric is
   grounded in WHAT ACTUALLY EXECUTED from the task event record, and the
   employee brief demands methods-actually-run reporting. Live proof: a
   production mission whose employees produced correct-looking values with
   zero tools executed failed twice with evidence-grounded verdicts
   ("zero commands were executed ... indicating the data was fabricated").
   Residual: non-browser method claims rely on the grounded rubric
   (model-based, evidence-armed) rather than a deterministic gate.

7. ~~Tool discovery (spec Part 20)~~ **CLOSED in B223**: the registry is now
   matched per-objective — interpreter + documented keyword capabilities →
   tools with B209 risk, verification kinds, honest gaps; additive wiring,
   never bypassing the B52 allowlist or B209 gate. `test-b223.js` (17).
8. ~~SSE/WebSocket push (spec Part 29)~~ **CLOSED in B224**: mission events
   push over SSE with native Last-Event-ID replay; the polling fabric
   remains as fallback (and stretches while push is live — §8 contract).
   `test-b224.js` (10), wire-tested against the real handler.
9. ~~Mission UI design system (Parts 32–51)~~ **CLOSED in B216/B221/B222**:
   DESIGN_SYSTEM.md + the mission instrument, then the all-screen migration
   (one green, three voices, 21 views verified at 390×844, 0 console
   errors). Vocabulary aligned with this matrix: capability names in
   `ToolDiscovery.js` (author-code / research / vision / data-analysis /
   git / outbound-send / scheduling / verification / …) are the canonical
   terms; docs and code use the same words for the same things.
