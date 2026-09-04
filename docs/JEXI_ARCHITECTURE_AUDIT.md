# JEXI OS — ARCHITECTURE AUDIT (B215)

> Method: traced actual execution paths (imports → registration → calls), not filenames.
> Statuses: **WORKING** (wired end-to-end, covered by passing tests) · **PARTIAL** (working
> core, documented limits vs spec) · **MISSING** (honestly absent) · **BLOCKED** (environment
> limits, reason given). Evidence: local suites + CI history + live prod checks.
> Verification snapshot at audit time: last full chain green on `1a383cb` (CI 4/4 workflows,
> prod deploy live, 22 env vars). ~588 director-lane checks across B208–B213 suites.

---

## 1. Subsystem-by-subsystem

### Frontend (Vite + React SPA → GitHub Pages + APK)
- **Entry:** `index.html` → `src/main.jsx` → `src/App.jsx` (view switch: chat, history,
  missions, agents, workshop, settings) + 80+ components.
- **Execution path:** components call REST (`/api/*`) via fetch; results render. Missions UI
  polls `/api/missions` (4s active / 20s idle) and `/api/missions/:id/events` (2.5s active,
  incremental append, capped at 300 events in memory).
- **Persistence:** none client-side beyond localStorage settings; server is source of truth.
- **Tests:** B207 browser-drive suite (phone-width layout, overflow, clipping); APK build in CI.
- **Status: WORKING** (all FE-called endpoints exist server-side — wiring check 11/11
  previously-suspected gaps were false positives; every `/api/*` the FE calls is mounted).
- **Problems / spec gaps:** no live **Work Graph visualization** (Part 42 — the graph is
  rendered as an event record list, not a graph); design system is implicit (Tailwind
  utility classes, terminal-flavored) — `DESIGN_SYSTEM.md` does not exist yet (Part 34);
  activity stream is real but minimal; no semantic motion layer (Parts 38–40). This is the
  biggest block of genuinely new work in the spec.

### Backend API (Express, `server/index.js` + `src/routes/surface.js`)
- **Entry:** `index.js` (boot gate: `JEXI_API_KEY` required in prod) — 153 routes;
  `surface.js` (B186+, thin adapters over existing services) — 72 routes. Total ~225.
- **Status: WORKING.** No TODO/FIXME/placeholder markers in production paths (grep clean).

### JEXI core / Director (`director/Director.js`, B208)
- **Execution path:** `UNDERSTAND (llm.interpret) → PLAN (subtasks) → DELEGATE
  (EmployeeSession) → SUPERVISE (Supervisor, token-stream) → VERIFY (Verifier) → RECOVER
  (ladder) → REPORT`, every stage emits canonical events; degradation is honest (decline
  with reason when no lane answers).
- **Tests:** `test-b208.js` (89 checks), `test-b211*.js` (295 checks).
- **Status: WORKING.**

### Objective interpreter (spec Part 4)
- **Current:** `INTERPRET_SYSTEM` prompt in `director/RealAdapters.js` → JSON
  `{understood, refinedObjective, userLine, assumptions[], ambiguity, clarifyingQuestion,
  risky, taskType, complexity, constraints[], successCriteria[], formatHint,
  needsVerification, subtasks[]}`; validated by `validateRefinement` (Director.js:518);
  consumed for objective/assumptions/constraints/criteria + replan.
- **Spec deltas:** no explicit provenance tagging (**USER_STATED vs INFERRED vs ASSUMED vs
  UNKNOWN**), no `unknowns[]`, no `desiredOutcome` distinct from objective, no
  `requiredArtifacts[]`, no candidate employees/tools surfaced at interpretation time.
- **Status: PARTIAL** — B215 closes this (structured objective state, provenance-tagged).

### Mission manager / runner (`director/Mission.js`, `MissionRunner.js`, B211)
- **Execution path:** POST `/api/missions` → mission created (validated state machine,
  budgets: 24 items / 8 failures / 30-min wall / 1 replan / 6 discovery rounds) →
  background tick loop: apply steering → check budgets → claim ready work (deterministic:
  priority desc, createdAt asc; parallel batches MAX_PARALLEL=3; leases TTL 10 min) →
  execute → verify → checkpoint (atomic tmp+rename) → continue. **Boot recovery:** on
  server start, mid-flight missions resume (DONE never redone).
- **Tests:** `test-b211.js` (111), `tests/autonomy/backend-restart.js` (SIGKILL → fresh
  process → resume), `tests/autonomy/long-horizon-mission.js`, `browser-disconnect.js`,
  `failure-injection.js`.
- **Status: WORKING.**

### Work Graph (`director/WorkGraph.js`, B211)
- Nodes (work items, full lifecycle) + typed edges (BLOCKS / DISCOVERED_FROM / SUPERSEDES /
  PRODUCES); persisted atomically at `DATA_DIR/missions/<id>/graph.json`; the ONLY source
  of truth for ready/running/done; survives restart.
- **Tests:** `test-b211.js` A (relations, deterministic ready-work, leases, restart).
- **Status: WORKING.** (Spec's richer relation vocabulary — DEPENDS_ON, PARENT_OF,
  RELATED_TO, DUPLICATES, REPLACES — partially covered by existing edges; noted, not
  blocking: existing four relations are the ones execution actually uses.)

### Discovered work (spec Part 7)
- `### DISCOVERED` ingestion with dupe-merge, lineage (DISCOVERED_FROM), budget-bound
  (6 rounds), classification EXECUTE_NOW/QUEUE/DELEGATE/DEFER/IGNORE_WITH_REASON.
- **Tests:** `test-b211.js` D. **Status: WORKING.**

### Complexity / risk analyzer + execution depth (`ComplexityAnalyzer.js`, B211 B2)
- Heuristics floor (never inflate) + LLM refinement; SIMPLE→LONG_HORIZON depth; CRITICAL
  risk approval gate (nothing runs before user approval; gate reasons cite the objective's
  words). **Tests:** `test-b211b2.js` A/B/I/J. **Status: WORKING.**

### Imagination engine (`ImaginationEngine.js`, B211 B2)
- Bounded counterfactual strategy search: ≤3 branches, ≤2 LLM calls, judge with
  deterministic fallback, CREATED→SELECTED/REJECTED with reasons; SIMULATION_UNAVAILABLE
  honesty (skip recorded with reason, never faked); PREDICTED vs ACTUAL compared at
  mission end → deviation + lesson. **Tests:** `test-b211b2.js` C/D/F/H.
- **Status: WORKING** (bounded exactly as spec Part 10 demands).

### Operational learning / lessons (`Lessons.js`, B211 B2)
- failure → cause → strategy → lesson, persisted across missions
  (`DATA_DIR/missions/lessons.json`, 300-entry cap, token-relevance retrieval, dedupe);
  lessons reach the NEXT plan prompt. **Tests:** `test-b211b2.js` E/K,
  `failure-injection.js` 1b/2/6. **Status: WORKING** (adaptation through experience; no
  model-retraining claims anywhere).

### Employees (`director/Employees.js`, `EmployeeSession.js`, `AgentRoster.js`, B208)
- Stable identities (person → role → capabilities → model session; model swappable under
  the same name); brief = structured task contract; honesty rule: "Report only methods you
  actually executed this session." **Tests:** b208/b209 suites; `test-b212.js` roster.
- **Status: WORKING.**

### Model router + provider fallback (`director/ModelRouter.js`, B208/B209)
- 9-rung fallback ladder, telemetry-informed; FALLBACK NEVER CHANGES THE EMPLOYEE;
  injected 429s → MODEL_SWITCHED → delivered (tested). Provider-agnostic (OpenRouter,
  Groq, DeepInfra, Cerebras, + OpenAI-compatible). No GPT-6 dependency, no paid-key
  requirement. **Status: WORKING.**

### Tool system (spec Part 20/22)
- **Current:** employee profiles carry `supportedTools` (web-search, run-command,
  browser-act); B209 permission gate ENFORCES declared permissions (READ/WRITE/EXECUTE/
  NETWORK/GIT/DESTRUCTIVE) per tool, PERMISSION_DENIED otherwise; CommandRunner is a real
  allowlisted executor (node, node --test, python3, ls, cat, head, tail, wc, grep, echo,
  diff; one plain command per block; REAL exit code + stdout/stderr back); MCP + plugins +
  skills exist (`/api/mcp`, plugins, `/api/skills/*`).
- **Spec delta:** tools are injected by employee profile, not discovered per-objective
  from a capability-matched registry with per-tool risk/verification metadata.
- **Status: PARTIAL** — real and permissioned, but no objective→capability→tool discovery
  pass. (Deferred: the current model is safe and tested; discovery is an optimization, not
  a correctness gap. Candidate for a later phase with evidence.)

### Execution runtime (shell/Python/Node)
- CommandRunner (above) inside per-task workspaces; CodeModeRuntime /
  CodeRuntimePython / CodeRuntimeNode for the build lane; `/api/processes` process
  manager. Events COMMAND_STARTED/COMPLETED with real output. **Tests:** `test-b210.js`
  (64). **Status: WORKING.**

### Computer runtime + computer use (spec Parts 13–16)
- `ComputerRuntime.js` dispatch: local / remote / docker / mock (mock is explicit-only,
  never a default; docker honestly returns "not wired in this build"). Atlas lane
  (`ComputerOps.js`, B211 B3) drives the REAL virtual desktop (DesktopManager +
  Playwright) behind Director permission + telemetry rules. Observe→act→verify loop
  enforced (no blind action sequences).
- **Prod honesty:** slim image sets `JEXI_NO_BROWSER=1` → browser/computer capabilities
  report **BLOCKED (no Chromium in slim image)**, not faked. Full image has Chromium.
- **Tests:** `test-b211b3.js` (57), `test-computer-runtime.js`, `test-browser-verify.js`.
- **Status: WORKING** (adapter names differ from spec's Linux/Android taxonomy — the real
  adapters are local/remote; an "AndroidRuntime" does not exist and is not claimed).

### Verification (`director/Verifier.js`, B208)
- WORK → VERIFY → ACCEPT/REJECT enforced for every substantive task; rubric evaluation
  against the task's OWN success criteria + acceptance gates; action-completed ≠
  objective-verified. **Tests:** b208 suite. **Status: WORKING.**

### Recovery / replanning
- Layered ladder: model-lane retry → assignment ladder (RETRY/REASSIGN/ESCALATE) → replan
  (budgeted); failure classification; no infinite retries (budgets); failed strategies
  recorded and fed to the next plan as failureContext. **Tests:**
  `failure-injection.js` 1a/1b/2. **Status: WORKING.**

### Mid-mission steering (spec Part 26)
- POST `/api/missions/:id/steer` → impact analysis → invalidate affected ONLY (done work
  never invalidated; SUPERSEDES lineage) → replan → continue. **Tests:** `test-b211.js` F.
  **Status: WORKING.**

### Memory (spec Parts 8, 12, 28)
- Long-term memory (user facts/preferences, vector store, project memory), mission memory
  (graph + events + lessons + imagination record persisted per mission), compaction engine
  for long contexts. "Continue." reconstructs mission state without re-asking
  (test-b211.js J).
- **Known limit (B216 correction — proven live, not theorized):** chat TRANSCRIPTS *and
  mission records* live on the ephemeral container disk (`DATA_DIR/conversations/`,
  `DATA_DIR/missions/`). They survive PROCESS restarts (atomic files + boot recovery,
  tested by SIGKILL→resume) but NOT container replacement: on 2026-09-04 a Render
  free-tier hibernation + cold wake wiped a live mission record mid-verification
  (instance `…-hibernate-…`, uptime ~17 min at check). The keepalive cron was starved
  for 3h by GitHub Actions queue pressure, so the brain slept. Redis-backed state
  (memory, identity) survived. **Fixed in B217: `RedisMirror.js` syncs
  `missions/world/conversations` to Redis every 30s and rehydrates missing files on
  boot (`hydrateMirroredDirs()`, disk-wins rule, `test-b217.js` incident replay). A
  cold wake now costs ~60s, not the mission. Residual gap: the last ≤30s of writes.**
- **Status: WORKING (in-process persistence + recovery + Redis mirror rehydration,
  B217) / PARTIAL (≤30s write window on hard container kill).**

### World state (spec Part 9)
- **Status: MISSING.** Nothing tracks files/processes/browser/repos/tools/network as an
  explicit, persisted, planning-visible environment state. B215 closes this.

### Event system (spec Part 29)
- Events: append-only, chained ids, persisted per mission; FE polls with incremental
  fetch (reconnect-safe: refetch full tail on view re-entry; duplicate-safe: append by
  last id). Browser disconnect does NOT terminate backend work (missions run server-side;
  tested in `browser-disconnect.js`).
- **Spec delta:** no SSE/WebSocket push (spec says "use existing infrastructure where
  appropriate" — the polling fabric IS the existing infrastructure; push would be a new
  subsystem). Poll intervals are adaptive (2.5s only while active).
- **Status: WORKING (polling fabric, reconnect-safe) / PARTIAL vs spec's SSE preference.**

### Telemetry (`Telemetry.js`, `ChatEventLogger.js`)
- Real observed performance only (success, duration, verdicts, provider failures) feeding
  router bias. No synthetic metrics. **Status: WORKING.**

### Git integration (`WorkspacePublisher.js`)
- GitHub Contents API → jexi-workspace Pages; atomic publish; TTL sweep; b64 binary
  support (B214 addendum, byte-identical verified on prod); checkpoints/rollback for
  workspace file edits (`/api/workspace/checkpoint|rollback`).
- **Status: WORKING** (just verified end-to-end on prod today: jexi-demo images).

### Security (spec Part 30)
- Boot gate (JEXI_API_KEY prod), x-jexi-key enforcement, permission presets, trust
  folders, risk guard, rate limiter, AnswerSanitizer, secret redaction in logs
  (CredentialStore + resolveCredential; keys never in prompts/logs/artifacts — enforced
  across B-builds; .env untracked).
- **Status: WORKING.**

### Tests
- 143 test files; ~140 in `npm test` chain; director lane: 588 checks green; autonomy
  E2E: long-horizon, failure-injection, backend-restart, browser-disconnect; B207
  browser-drive (visual layout, phone width); api-surface test; roster audit script.
- **Status: WORKING** (full chain green at `1a383cb`).

---

## 2. Mock/placeholder/dead-code scan

- `grep TODO|FIXME|XXX` in `server/src` + `index.js`: **0 hits** (one occurrence is inside
  a prompt string instructing the model NOT to emit placeholders).
- Mock usage: `MockRuntime` is an explicit, opt-in provider string (test-only; default is
  auto→local/remote; never defaulted in production). `docker` provider honestly returns
  "not wired in this build". No other mocks found in production paths (mocks live in
  tests, clearly separated).
- Dead routes: none found — all 72 `surface.js` routes are FE-called or admin-used; FE
  wiring check passed 11/11 on deep verification.

## 3. Honest gap list vs this spec (the B215+ plan)

| # | Spec part | Gap | Phase |
|---|---|---|---|
| 1 | Part 1 | This audit document | **B215 — DONE** |
| 2 | Part 4 | ObjectiveInterpreter structured state + provenance tags (USER_STATED/INFERRED/ASSUMED/UNKNOWN), unknowns, desired outcome, required artifacts | **B215 — DONE** (`ObjectiveInterpreter.js`, Director-wired, `test-b215.js` §1–2) |
| 3 | Part 9 | WorldState — explicit persisted environment state, updated by real actions, read at planning | **B215 — DONE** (`WorldState.js`, EmployeeSession/MissionRunner/publish seams, `/api/missions/:id/world`, `test-b215.js` §3–4) |
| 4 | Parts 32–51 | Human-first UI evolution: design system doc, work-graph visual experience, semantic motion, employee UI, error UI, mobile-first pass, performance | **B216 (next build — it is ~20 spec parts of work and deserves a dedicated session, not a rushed bolt-on)** |
| 5 | Part 20 | Objective→capability→tool discovery registry (current: per-employee tool injection — safe but not discovery) | Later phase |
| 6 | Part 29 | SSE/WebSocket push (current: adaptive polling, reconnect-safe) | Later phase (explicit spec permission to use existing fabric) |
| 7 | Part 56/60 | Docs: DESIGN_SYSTEM, HUMAN_UI_AUDIT, GENERAL_INTELLIGENCE_AUDIT, IMPLEMENTATION_REPORT + matrix vocabulary alignment | With their phases (never before the work is real) |
| 8 | Part 13 | "AndroidRuntime" adapter does not exist — not claimed, not faked; computer use reports real adapters only | Not scheduled (would need real Android infra; honest BLOCKED by environment) |
| 9 | Memory | Chat transcripts ephemeral across deploys (env limitation, documented) | **DONE in B217** — Redis mirror (`jexi:mirror:*` keys, 30s sync, boot rehydrate) |

## 4. What B215 delivers (this build)

1. This audit (evidence above).
2. **ObjectiveInterpreter upgrade** — structured objective state with provenance tagging,
   wired into the REAL Director interpret path (schema + validator + consumer), tested.
3. **WorldState** — new service tracking the real environment (files, processes, browser,
   repos, tools, network, runtime caps) from REAL action seams (CommandRunner, ComputerOps,
   MissionRunner), persisted per-mission + global snapshot, readable at planning, exposed
   via API. No fabricated state — an empty world state is reported empty.
4. Tests for both + full chain green + ship.
