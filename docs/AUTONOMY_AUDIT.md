# B211 — AUTONOMY AUDIT (PHASE A: INSPECTED, MODIFIED NOTHING)

> Spec §63 Phase A requires this document BEFORE implementation. Everything
> below was verified by reading the actual source tree on 2026-09-04. No file
> was modified during the audit. Classification per spec §4:
> **EXISTS / PARTIAL / MISSING / BROKEN / MOCK / UNUSED / DISCONNECTED**.

---

## 1. Actual architecture (as shipped, main @ `1114977`)

### 1.1 Entry points

| Entry | File | What happens |
|---|---|---|
| Web chat | `client → POST /api/chat` (`server/index.js`, ~148 routes) | NDJSON stream (think/stream/log/team/narration/plan/heartbeat/done). Result persisted to a result store (B48 recovery — client can poll `/api/chat/result` after disconnect). |
| APK | Capacitor shell over the same web build | Same backend. |
| Scheduled/NL tasks | `TaskScheduler.js` | NL scheduling, restart-safe (DATA_DIR), delivers via email/chat/file. |
| Connectors | `/api/connectors/:name/inbound` | Webhook/WhatsApp/email ingress. |
| MCP | `mcp-server.js` + `McpClient.js` | External tool bridge. |

### 1.2 The two lanes

**Lane A — the Director (B208–B210, `server/src/services/director/`, 13 files, 2679 lines).**
`Director.js` (603) interprets → plans → staffs (Employees, 338) → delegates
(EmployeeSession, 479, per-employee chat with model lane) → supervises live
(Supervisor, 181, watches the token stream, bounded checkpoints, NEEDS channel,
redirects) → executes via allowlisted shell (`CommandRunner`, 148, CommonJS-confined
workspace) → verifies (Verifier, 111, rubric scoring + B210 anti-fabrication gate)
→ reports. Recovery ladder + replan loop. ModelRouter (157) = 9-rung provider
ladder; employee identity preserved across provider swaps (tested B209).
Telemetry (126) per employee/provider. TaskState (164) persists per-task records
with chained events (`parentEventId`); multi-task conversation index. 245 tests
(B208 89 / B209 92 / B210 64), CI 5/5, live on Render, independently E2E'd.

**Lane B — the legacy pipeline (pre-B208).**
`index.js` chat dispatch → TeamRouter/Orchestrator (`Orchestrator.js`, 1725) →
typed graphs via `GraphRunner.js` (agent/tool/verifier/gate nodes, `when()`
edges, maxSteps guard, failureHistory re-injection — B50 P6) + `PipelineGraphs.js`
→ 213 profiled specialists (`AgentRoster.js`), departments, DSH coding loop.
Fully functional and CI-tested, but it is the OLD lane; B211 builds on Lane A.

### 1.3 Long-running systems that already exist (real, not mock)

| System | Files | What it does | Status |
|---|---|---|---|
| Goal Engine | `GoalEngine.js` (336), `GoalJobQueue.js` (560) | autonomous goal runs; autonomy levels ask/full; preflight question round; failure→history→correct→verify retry; `DATA_DIR/goal-jobs.json`; **on boot queued jobs re-run, parked questions survive restart** | EXISTS (legacy lane) |
| Task Registry | `TaskRegistry.js` (370) | persistent multi-task registry (statuses, project entities, plan steps, decisions, "continue the first task" resolution) | EXISTS (legacy lane, context tracker — NOT a work graph) |
| Task Manager | `TaskManager.js` (381) | background tasks + `task.*` events | EXISTS (legacy lane) |
| Chat jobs | `ChatJobs` (B85 durable chat; wired as `chatExecutor` in GoalJobQueue) | chat work survives client disconnect, resumable | EXISTS |
| Event log | `EventLog.js` (181) | event-sourced per-session log, Redis-mirrored (30-day TTL), no second persistence mechanism | EXISTS |
| Compaction | `CompactionEngine.js` (297) | token-pressure → structured checkpoint + retained tail | EXISTS |
| Memory | `MemoryManager.js` (1408) | hybrid keyword/vector recall, Redis-mirrored persistence | EXISTS |

### 1.4 Computer-use stack (real, browser automation verified in tests)

| Piece | File | Reality |
|---|---|---|
| Runtime abstraction | `ComputerRuntime.js` | providers local/remote/docker/mock with **honest capability reporting** (docker = "not configured"); `/api/computer/status`, `/api/computer/call`; tested in `test-computer-runtime.js` |
| Agent | `ComputerUseAgent.js` (453) | full action loop: normalize (goto/write_file/click/type/press/scroll/…), error sniffing, memory saves, training prompt |
| Browser | `DesktopManager.js` (507) | real Playwright browser, screenshots to DATA_DIR, "virtual desktop" the user can watch, relaunch cooldown, genuine liveness checks |
| HTTP surface | ~15 routes `/api/desktop/coder/*` | goto, click, click-index, click-text, elements, press, scroll, page-text, back, forward, screenshot-json, save-screenshot, execute |
| UI | `TerminalScreen.jsx` + desktop routes | screenshots/terminal panels exist |

**Critical finding: the computer stack is DISCONNECTED from the Director lane.**
It serves Lane B (and direct routes) only. No Director employee can drive the
browser; no `COMPUTER_*` events in the team vocabulary; no Atlas in the
Employees registry.

### 1.5 Everything else that exists and must not be duplicated

ToolRegistry/ToolRuntime (~151 tools, schemas, tiers), McpClient, plugins,
hooks, connectors (WhatsApp/email/webhook), RiskGuard (destructive-action
classification), GitHubRepo/GitHubEngine (scan/edit/commit/PR), WorkspaceRuntime
+ WorkspacePublisher (auto-publish builds), SandboxLocal/BashPersistent/
ProcessManager (real subprocesses), SubagentRuntime/AgentTeams/WorkerRouter
(legacy multi-agent), AgentMail (inter-agent messages), SelfMonitor,
NotificationsScreen, mobile APK pipeline, Docker image publish. Frontend: 53
components incl. TeamLive (B208 strip), TeamManager, GoalsScreen, TasksScreen.

---

## 2. Spec-vs-reality gap table (the B211 work list)

| # | Spec capability | Classification | Evidence / what exists | Gap to close |
|---|---|---|---|---|
| 1 | **Persistent Work Graph** (missions, work items, typed relations BLOCKS/BLOCKED_BY/DISCOVERED_FROM/SUPERSEDES, survives restart) | **MISSING** | TaskState persists per-task records but they are flat single-turn tasks; TaskRegistry is Lane B's context tracker | New `WorkGraph` store: task nodes + typed edges + status + result hashes; deterministic ready-work queries; persisted under DATA_DIR |
| 2 | **Mission Manager + state machine** (CREATED…CANCELLED validated transitions, budgets, user controls) | **MISSING** | Director mission = one /api/chat request; no cross-turn mission object | New `Mission` module: domain model, validated transitions, checkpoints, budgets/limits, pause/resume/cancel/retry/skip/approve API |
| 3 | **Ready-work engine + "Continue." resume without re-asking** | **MISSING** | GoalJobQueue re-runs goals on boot (Lane B); Director has nothing | Ready-work scheduler over WorkGraph; Continue → reconstruct + resume from persistence |
| 4 | **Execution decoupled from the HTTP request** (restart-safe, disconnect-safe) | **PARTIAL** | B48 result store + B85 chat jobs + GoalJobQueue boot re-run exist for Lane B; Director runs inside the request | MissionRunner as a background loop with checkpoints; chat/stream becomes a view onto mission events |
| 5 | **Discovered work** (EXECUTE_NOW/QUEUE/DELEGATE/DEFER/IGNORE_WITH_REASON) | **MISSING** | NEEDS is a question channel to the user, not task creation | Employees emit DISCOVERED findings → classified into the WorkGraph |
| 6 | **Imagination Engine** (bounded counterfactual search, PREDICTED vs ACTUAL, never SIMULATED-as-ACTUAL) | **MISSING** | Nothing (honest) | New module; bounded by MAX_BRANCHES/DEPTH/COST; strategy store with deviation+lesson |
| 7 | **Complexity/risk analyzer → execution depth** (SIMPLE→LONG-HORIZON) | **PARTIAL** | Director's interpret step already outputs complexity + risk for planning; RiskGuard classifies destructive actions | Standalone analyzer mapping complexity/risk → depth (simple run / checkpointed / imagination-then-run), driving MissionRunner |
| 8 | **Mid-mission steering** (impact calc, invalidate only affected, replan, continue) | **MISSING** | No mission concept → no steering. Recovery/replan exists for single failed tasks | Steering message → diff against open work → invalidate affected subtree (mark SUPERSEDED) → replan → continue |
| 9 | **ComputerRuntime in the Director lane + Atlas employee + live computer panel** | **DISCONNECTED** | Real stack exists (§1.4) but only Lane B/direct routes use it | Register Atlas (computer ops) in Employees; computer tool gates (BROWSER/COMPUTER permissions); observe→act→observe→verify loop; `COMPUTER_*` events; UI panel with real telemetry only |
| 10 | **Async multi-agent execution** (worker pool, leases, cancellation, graceful shutdown) | **PARTIAL** | Director already runs dependency waves with MAX_PARALLEL=3 inside a turn; AgentTeams/WorkerRouter exist in Lane B | Persistent worker pool across turns over ready work; task leases/locks; cancellation; graceful drain |
| 11 | **ModelRouter fallback** (employee identity ≠ model identity) | **EXISTS** | B209 ModelRouter 9-rung ladder, telemetry-informed, identity preserved — tested | None (keep; missions reuse it) |
| 12 | **Verification: ACTION COMPLETED vs OBJECTIVE VERIFIED** | **PARTIAL** | Verifier scores rubrics + anti-fabrication gate (B210); per-action FILE_CREATED/command events distinguish action from claim | Add acceptance criteria per mission; VERIFICATION must be evaluated against mission-level criteria, not per-task only |
| 13 | **Tool discovery (filter by objective)** | **PARTIAL** | ToolRegistry has ~151 tools with schemas/tiers; Lane B auto-selects tools per task; Director employees have FIXED tool sets | Objective-driven tool discovery for Director employees (query registry, gate by permissions) |
| 14 | **Operational learning** (failure→cause→strategy→lesson, retrievable) | **PARTIAL** | Telemetry per employee/provider; employee history; recovery records with attempts | Lessons store: extract lesson on failure/recovery, retrieve relevant lessons at planning/steering time |
| 15 | **Artifacts engine** (hashes, relationships, never claim non-existent) | **PARTIAL** | Task workspaces on disk; B210 anti-fabrication gate catches non-existent files | Artifact records with content hashes, produced-by/derived-from edges in the WorkGraph |
| 16 | **Event sourcing: frontend never invents events** | **EXISTS** | B208 rule enforced; team events API with `sinceEventId` reconnect | Extend vocabulary: MISSION_*, WORK_*, COMPUTER_*, DISCOVERY_*, IMAGINATION_* — all from real execution only |
| 17 | **No mocks in production** | **EXISTS** | Mock runtime provider is env-gated and test-only; KNOWN_CAPS real tokens only | Keep discipline; mock mission fixtures live under `tests/autonomy/` only |
| 18 | **Secrets never exposed** | **EXISTS** | shellEnv scrubbing, sanitizeWorkProduct, permissions gates | Extend to new mission/computer/imagination event payloads + artifacts |

**No BROKEN or fake subsystems were found in the Director lane or the computer
stack.** The dominant pattern is **DISCONNECTED/MISSING**, not broken — the
building blocks are real and tested; the autonomy layer that composes them is
what B211 adds. Legacy-lane systems (GoalEngine, TaskRegistry, TaskManager)
stay untouched per spec §63 (no rewrites) — the Mission layer supersedes them
for Lane A use cases without deleting them.

---

## 3. Recommended implementation order (spec §52 dependency order)

**Phase B1 — the mission spine (everything else hangs off it):**
1. `director/WorkGraph.js` — task nodes, typed relations, statuses, ready-work queries, leases, persistence.
2. `director/Mission.js` — mission state machine, budgets, checkpoints, user controls.
3. `director/MissionRunner.js` — the bounded autonomous loop (steering → ready work → analyze → staff → execute → verify → learn → checkpoint → continue), background-executed, restart-safe.
4. Chat wiring: "Continue." / steering recognition in the Director; `/api/missions/*` routes; frontend Mission view (extend TeamManager, no replacement frontend).
5. Discovered work classification + ingestion.
6. Tests: graph/ready-engine unit, state machine, restart-recovery, steering, discovery.

**Phase B2 — intelligence:** complexity/risk analyzer → depth; Imagination Engine (bounded, honest); lessons store.

**Phase B3 — computer:** Atlas employee + computer tool gates + observe/act/verify loop; `COMPUTER_*` events; live computer panel (real screenshots via existing DesktopManager routes).

**Phase B4 — proof:** failure-injection suite, backend-restart test, browser-disconnect test, long-horizon mission test (build+test+fix+verify a small full-stack app, unguided); `docs/CAPABILITY_MATRIX.md` + `docs/AUTONOMY_IMPLEMENTATION_REPORT.md` with evidence.

---

## 4. Non-negotiables carried into implementation

- No rewrites of B208–B210 or the legacy lane; extend, don't duplicate.
- Every new subsystem must be IMPORTED → REGISTERED → CALLED → EXECUTED → PERSISTED → TESTED → VERIFIED (§63).
- SIMULATED is never presented as ACTUAL; SIMULATION_UNAVAILABLE marked honestly.
- PASS only from real successful tests; BLOCKED explained, never converted.
- Frontend renders events; it never invents them.
- Inspect-first: this audit is the contract; deviations get documented here.
