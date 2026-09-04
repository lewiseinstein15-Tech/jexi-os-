# B211 — AUTONOMY IMPLEMENTATION REPORT (evidence-based, 23 sections)

> The rule this report obeys: **code existence is not PASS.** Every claim
> below points at a real passing test, a commit, or a live check. BLOCKED is
> explained where it exists; nothing is converted to PASS.
>
> Commits: `a9afee7` (Phase A audit + B1 spine) → `3db5b8a` (B2 intelligence)
> → `37cfda6` (B3 computer) → B4 (this build: proof suites + matrix + report).
> Verification at each step: CI 5/5 workflows green; Render deploy **live**
> (03:14Z B2, 03:55Z B3); production roster + computer status verified via
> the live API after B3.

## 1. Executive summary

JEXI now has a genuine autonomy layer on top of the Director lane: persistent
missions with a typed work graph that survive refreshes, restarts and
failures; an intelligence layer that classifies before it plans, imagines
bounded strategies for deep work, and learns operationally from every
failure and deviation; a computer-operations employee who drives the real
browser through the same honest event discipline as everything else; and a
proof suite that kills processes, kills viewers and injects failures to show
the system keeps its record true. **295 B211 checks** (540 director-lane
total), all green, all real execution — the model is scripted in tests, the
machinery never is.

## 2. Phase A — the audit (inspect first, modify nothing)

`docs/AUTONOMY_AUDIT.md` was written before any implementation: actual
architecture (two lanes, entry points, 18-row gap table), what exists vs
PARTIAL vs MISSING vs DISCONNECTED, and the dependency-ordered plan. Key
finding: the computer stack was real but DISCONNECTED from the Director
lane; nothing needed rewriting — the mission layer composes existing
machinery. This report follows that plan in order.

## 3. The Work Graph

`server/src/services/director/WorkGraph.js` — work items with statuses
(PENDING/RUNNING/DONE/FAILED/SKIPPED/SUPERSEDED), typed relations (BLOCKS,
DISCOVERED_FROM, SUPERSEDES, PRODUCES), content hashes, leases with TTL,
deterministic `readyWork()` (priority desc, createdAt asc), atomic
persistence (tmp+rename), `recoverAfterRestart()` (RUNNING→PENDING, DONE
never redone), `invalidateDownstream()` with blocking-role inheritance.
**Evidence:** `test-b211.js` section A — relations, deterministic order,
lease claim/expire/reclaim, supersede, restart recovery.

## 4. The Mission Manager + state machine

`Mission.js` — CREATED→PLANNING→EXECUTING→VERIFYING→COMPLETED (+
AWAITING_INPUT/PAUSED/FAILED/CANCELLED), illegal transitions THROW (tested),
budgets (maxItems 24, maxFailures 8, 30-min wall-clock window, 1 replan, 6
discovery rounds), usage accounting, append-only chained event log with
`sinceEventId` replay. **Evidence:** `test-b211.js` B.

## 5. Ready-work + "Continue."

The runner loop claims ready work deterministically, executes in dependency
order, and pauses/fails honestly when budgets exhaust. "Continue." on a
paused/resumable mission resumes from persistence with NO re-planning and
keeps in-flight results. **Evidence:** `test-b211.js` E/J;
`tests/autonomy/browser-disconnect.js` §1 (Continue. mid-run re-attaches with
replay + live events).

## 6. Execution decoupled from the HTTP request

Missions run in a background loop (`kick` + `setImmediate`); the chat bridge
is a subscribing VIEW with a 25s streaming window, polling summary, and full
replay on re-attach. A browser disconnect changes nothing server-side.
**Evidence:** `tests/autonomy/browser-disconnect.js` — viewer dies at event 3
(mission completes, 15 events persisted, 2 delivered), dead-on-arrival
viewer (mission completes unseen), reconnect gets MISSION_CREATED-first
replay then live completion.

## 7. Discovered work

Employees end deliverables with `### DISCOVERED` entries; the runner
classifies (EXECUTE_NOW/QUEUE/DELEGATE/DEFER/IGNORE_WITH_REASON), dedupes
against the plan, records lineage (DISCOVERED_FROM), and defers honestly at
budget. **Evidence:** `test-b211.js` D (incl. dupe-merge and budget
deferral) and the discovery instructions riding every item brief.

## 8. Mid-mission steering

`steer()` queues; the loop computes impact on OPEN items only (done work is
never invalidated), supersedes affected subtrees, creates replacement items,
records SUPERSEDES lineage. **Evidence:** `test-b211.js` F — only the
affected item superseded; replacement carries the steering context.

## 9. Complexity/risk analyzer → execution depth

`ComplexityAnalyzer.js` classifies before planning: SIMPLE/MODERATE/COMPLEX/
LONG_HORIZON × LOW/MEDIUM/HIGH/CRITICAL. LLM-first with a deterministic
heuristic floor; `decidedBy` records who decided; heuristics never inflate.
Depth mapping is one function (`depthFor`): imagination on/off, checkpoint
mode, parallelism, approval gate. **Evidence:** `test-b211b2.js` A/B
(including invalid-LLM and dead-lane fallbacks).

## 10. The CRITICAL-risk approval gate

Money, broadcast-to-many, or destructive-against-broad-scope objectives
pause AWAITING_INPUT before ANYTHING runs (no plan, no items, no sessions —
asserted). "approve" releases; a change ("no — only the test database") is
kept and injected into the REAL plan prompt as steering. **Evidence:**
`test-b211b2.js` I/J.

## 11. Imagination Engine (bounded counterfactual strategy search)

`ImaginationEngine.js` — ≤3 branches, ≤2 LLM calls, hard char budgets. All
branches start CREATED; a judge pass marks exactly one SELECTED (with the
verdict reason) and the rest REJECTED (with because-reasons). Single
candidate = selected without a judge call. Judge down = deterministic
first-viable, honestly labeled. **Evidence:** `test-b211b2.js` C.

## 12. SIMULATED is never ACTUAL

The selected strategy enters the plan prompt as a clearly-labeled PLAN INPUT
("imagined in the imagination pass — nothing has run"). No lane →
SIMULATION_UNAVAILABLE with the real reason; planning proceeds without it;
no fake review is ever invented at the end. **Evidence:** `test-b211b2.js`
H; `tests/autonomy/failure-injection.js` §5.

## 13. PREDICTED vs ACTUAL

At mission end, `comparePredictedVsActual()` computes the deviation from
real numbers (items delta, verdict match, failures, replans) and records a
lesson; the IMAGINATION_REVIEW event carries both sides.
**Evidence:** `test-b211b2.js` D/F (held-prediction and deviation paths).

## 14. Operational learning

`Lessons.js` — failure lessons (ladder exhausted), recovery lessons (what
worked), deviation lessons (predictions vs reality); deduped, capped (300),
persisted across processes; retrieved by token relevance into PLAN and
REPLAN prompts; lessons carry original+refined objective vocabulary.
**Evidence:** `test-b211b2.js` E/K; `tests/autonomy/failure-injection.js`
1b/2/6 — a failure in mission N verifiably steers mission N+1's planning.

## 15. Recovery engine (layered, all real)

Layer 1: model-lane fallback (injected 429s → MODEL_PROVIDER_FAILED →
MODEL_SWITCHED → delivered). Layer 2: assignment ladder (RETRY/REASSIGN/
ESCALATE with recorded recoveries; single-employee staffing honestly cannot
REASSIGN). Layer 3: mission replan — ONE different-approach round, dead
subtree SUPERSEDED, visible in the record. Layer 4: verification-failure
correction round with the real problems injected. **Evidence:**
`tests/autonomy/failure-injection.js` 1a/1b/2/3.

## 16. ComputerRuntime + Atlas

`ComputerOps.js` rides the existing ComputerRuntime/DesktopManager stack.
Atlas is Computer Operations: `computer` capability, `browser-act` tool,
enforced `COMPUTER` permission (browser-act requires READ+COMPUTER;
non-computer employees are PERMISSION_DENIED). Capability honesty is checked
at EXECUTION time: no browser → COMPUTER_BLOCKED with the true reason, zero
act/observe events invented. **Evidence:** `test-b211b3.js` C/D;
production roster verified live (Atlas = Computer Operations on the Render
API after deploy).

## 17. The browser loop (observe → act → observe → verify)

```browser blocks in an employee's output really execute (goto/click-index/
type-index/click-text/scroll/press/back/forward), ≤3 rounds, ≤4 actions per
round; after every round the REAL page state (title, text, numbered
elements, saved screenshot when available) feeds the next model prompt;
`browserActions` rides the RESULT message. **Evidence:** `test-b211b3.js` F
(the observed page state is verifiably in the next prompt); mission-level
telemetry in I.

## 18. Live computer-use UI

`ComputerPanel.jsx` renders only real COMPUTER_* events plus the real saved
screenshot (served by the existing screenshots route); nothing renders
without real computer work; layout-safe by construction (B207 lessons).
`useJexiEngine` maps COMPUTER_* to the live team strip; the engine keeps a
capped raw telemetry list. **Evidence:** frontend build green; event-shape
tests at the engine boundary; no frontend-invented events (event-sourcing
rule).

## 19. Model routing + employee identity

B209's ModelRouter (9-rung ladder, telemetry-informed) is reused untouched;
employee identity survives provider swaps; B211 adds no new identity
surface. **Evidence:** B209's 92 checks + `tests/autonomy/failure-injection.js`
§1a (fallback observed live under injection).

## 20. ACTION COMPLETED vs OBJECTIVE VERIFIED

Per-action truth: FILE_CREATED/COMMAND_*/TEST_*/COMPUTER_* events with exit
codes, byte counts and timings; the B210 anti-fabrication gate fails any
deliverable claiming execution results without real events. Per-mission
truth: `_finish` verifies the WHOLE deliverable against the mission's
success criteria (Vera), with ONE correction round before honest failure.
**Evidence:** B210 64 checks; `tests/autonomy/failure-injection.js` §3;
`tests/autonomy/long-horizon-mission.js` (verdict corroborated by real
TEST_* events).

## 21. Persistence + restart safety

Every mutation is checkpointed atomically; boot recovery requeues in-flight
items and records MISSION_RESTART_RECOVERY + usage.restarts. Proven across
REAL process boundaries: child process SIGKILLed mid-item, second process
boots from disk only, resumes, completes; item 1 executed exactly once
across both processes (session log proof); exactly one MISSION_COMPLETED.
**Evidence:** `tests/autonomy/backend-restart.js` (11 checks).

## 22. Long-horizon autonomy (the flagship proof)

An unguided 2-item mission builds a full-stack app: item 1 writes server.js
(with a planted bug) + public/index.html; item 2 writes the test suite and
runs `node --test` — which REALLY FAILS (real exit ≠ 0, real assertion
output); the employee's fix is verifiably grounded in that real output; the
re-run REALLY PASSES; the mission verifies and completes. The TEST then
re-runs the suite itself in a fresh process (zero trust) and confirms 2
passing tests, and checks the FIXED file content on disk. Two production
fixes came out of this test: mission-scoped workspaces (items share
`jexi-workspace/director/<missionId>`) and sanitized subpath artifacts
(`public/index.html` survives). **Evidence:**
`tests/autonomy/long-horizon-mission.js` (14 checks).

## 23. Evidence index + honest limitations

**Test totals (all green, all real execution):** B208 89 · B209 92 · B210 64
· B211 spine 111 · B2 intelligence 74 · B3 computer 57 · B4 autonomy 53
(long-horizon 14, failure-injection 17, backend-restart 11,
browser-disconnect 11). Director lane total at B211 close: **540** (B211 alone: **295**; now 588 after B212+B213 — see `docs/CAPABILITY_MATRIX.md`, the living truth table).
CI: 5/5 workflows green on every B211 commit. Render: deploys live and
verified via API after B2 (03:14Z) and B3 (03:55Z).

**Known limitations (BLOCKED/deferred — never converted to PASS):**
1. ~~Same-session same-name artifact rewrites~~ CLOSED in B212 (FILE_UPDATED
   fix-in-place, zero-trust `cat` proof).
2. ~~Live production site-driving~~ CLOSED in B212 (live E2E, twice; the
   prod slim image ships no Chromium by design — 512MB hosts — and computer
   use now blocks immediately with the true reason instead of burning dead
   actions). Real browser driving on prod needs a bigger plan / full image.
3. Worker pool is per-mission batches (3 parallel), not a cross-mission
   persistent pool; single runner process per deployment. Deferred by design.
4. ~~No dedicated graph-visualization screen~~ CLOSED in B212 (MissionsScreen:
   list, work graph, live events, controls, answers, steering — real API only).
5. Imagination deviation lessons are deterministic templates from real
   numbers (no LLM narrative). Deferred by design.
6. Employee method-fabrication (found live in the B212 E2E) CLOSED in B213:
   deterministic browser-provenance gate + evidence-grounded verification.
   Residual: non-browser method claims rely on the grounded rubric.
