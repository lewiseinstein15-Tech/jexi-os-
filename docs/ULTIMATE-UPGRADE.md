# JEXI OS — Ultimate Architecture Upgrade (implemented record)

**Date:** Sept 6, 2026 · **Status:** implemented + tested (see commits below)
**Spec:** the "ULTIMATE ARCHITECTURE UPGRADE" (Lewis's option E) — executive
agent OS: JEXI stays the boss.

```
USER → JEXI → PLANNER → TASK GRAPH → CAPABILITY ROUTER
     → AGENTS / TOOLS / MCPs → EXECUTION → VERIFICATION → JEXI → USER
```

**Lewis's standing override honored throughout:** NO new buttons, screens or
menus. The UI stays exactly Chat / Chat History / Settings / Workshop.
Everything below flows through existing chat events, the Workshop, and
read-only APIs.

---

## What was actually built (and what was NOT)

### 1. Capability Router — smart tool use, FULLY solved (§7, §11)
`server/src/services/CapabilityRouter.js` (NEW)

The gap before: the 42 MCP servers (515 tools) were reachable only through a
test API route — normal chat never saw them. Now EVERY chat turn routes:

- **intent → capability tags → MCP servers**: 22 capability tags
  (web_search, encyclopedia, papers, news, docs, math, weather, books,
  music, economy, maps, files, git, …) mapped to the 42 servers.
- **query keyword boosts**: the user's own words refine the set ("weather in
  Nairobi" → weather server; "papers on quantum computing" → arxiv included;
  "book like Dune" → openlibrary).
- **minimum set, never all 515**: round-robin selection across routed
  servers, capped at 16 tools / 5 per server — no capability starvation.
- **sleeping servers cost nothing**: schemas come from the tool directory
  (all 515 tools now carry real input schemas); the server wakes on first
  call through the gateway.
- **dispatch**: `mcp__<server>__<tool>` function names flow through
  `ToolRuntime.executeTool` → `MCPGateway.invokeMcpTool` (lazy connect,
  permission grants, destructive-call gates, timeout — all pre-existing and
  preserved).
- **lightweight intents stay lightweight**: direct_answer / conversation /
  memory_query route zero MCP tools and refuse hallucinated mcp__ names
  (same spirit as the B52 allowlist).
- Browser trio (playwright, playwright-ea, chrome-devtools) is never routed
  into chat — host-dependent, see docs/BROWSER-PLAN.md.

The user SEES routing live: an `agent.log` chat event
("🔌 Capability routing: …") names the servers JEXI picked, every turn.

### 2. Registries with metadata + health (§4, §5, §6, §8, §10)
`server/src/services/ArchitectureViews.js` (NEW — view layer, zero rewrites)

Live snapshots (no duplicated state) of:
- **agents** (252): id, role, capabilities, tools, skills, health, permissions
- **tools** (218 registry tools): category, engine, timeout, intent allowlists
- **MCP** (42 servers): status (ready/connected/error/cooldown), **circuit
  state**, trust level, permissions, tool counts, capability tags
- **plugins** (51): tools/skills surface, lifecycle

API: `GET /api/architecture` (one snapshot, §20 observability).

### 3. Persistent Task Graph (§12–§16)
`server/src/services/TaskGraph.js` (NEW)

Runs + tasks with `dependsOn`, agent, tools, capabilities, attempts,
durations, results — persisted to `DATA_DIR/architecture/runs.json`
(atomic write, last 50 runs). Dependency-aware **parallel** execution
(worker pool), and the full worker lifecycle (§17):

```
CREATED → QUEUED → STARTING → READY → RUNNING → WAITING → COMPLETED
                     terminal: FAILED | TIMEOUT | CANCELLED | BLOCKED
```

### 4. Failure recovery (§18)
- per-task **retries** with exponential backoff (default 2 retries)
- per-task **timeouts**
- run **cancellation** — in-flight workers get the abort signal; a result
  arriving after cancel is DISCARDED (an aborted run never reports success)
- **dependency cascade**: a failed task BLOCKS its dependents
- **WAITING** state: a worker can pause for input (like a blocking ask)
- **MCP circuit breaker** (in the gateway): 3 consecutive failures → 5-min
  cooldown with fast honest refusal; success closes it; health shows it

### 5. ExecutionBackend abstraction (§38)
`server/src/services/ExecutionBackend.js` (NEW)

One seam between the Task Graph and wherever work runs:
- **JexiNativeBackend — BUILT**: a task = one worker turn through the
  existing WorkerRouter + gated tool runtime (nothing rewritten).
- **OrcaBackend — DESIGNED, NOT BUILT**: the registerBackend seam exists; no
  code, no dependency (see docs/research/orca-study.md for the adopt/reject
  reasoning). JEXI works fully without Orca.

### 6. External Capability Providers (§41)
`server/src/services/ExternalProviders.js` (NEW)

The one-way authenticated bridge shape for external systems:
- register / list / call with timeout, retry, circuit breaker, audit log
- **JEXI Market registered as a NOT-CONNECTED placeholder** (id
  `jexi-market`, domain financial-market-intelligence, 7 capabilities) —
  deliberately no endpoint, no code merged, no import. Calling it returns an
  honest "not connected" answer, never a fake success.
- **Separation rules enforced by design**: Main JEXI initiates every call;
  the Market never initiates and never touches JEXI memory/tools/MCPs/agents;
  JEXI never depends on it.

### 7. Observability without new UI (§20)
- `GET /api/architecture` — the full registry/capability/backend snapshot
- `GET /api/architecture/runs` + `/api/architecture/runs/:id` — run list +
  full execution timeline (every lifecycle event, timestamped)
- chat events: capability-routing line every turn; tool events already flow
- NO new buttons/screens — Lewis's rule.

### 8. Security (§33) — verified, preserved
- Owner auth is REAL (access-key based, authorization flows with owner
  tracking) — a repo-wide search confirms **zero** `username == "Lewis"`
  style checks anywhere.
- Per-agent permission gates, per-server MCP grants, destructive-call
  authorization, circuit breakers — all preserved and extended.

### 9. Self-improvement (§35–§37)
Sandboxed, reviewed, rollback-able — the existing Chief Architect flow
(Architect.js + approval gates) remains the only self-modification path.
No uncontrolled self-modification was added. No benchmark overfitting.

## What was deliberately NOT built (honesty section)
- **OrcaBackend** — designed only (study in docs/research/orca-stury.md →
  `orca-study.md`). Zero dependencies added.
- **Real JEXI Market integration** — the separation rule forbids it; only
  the provider abstraction + honest unavailable placeholder exist.
- **No new UI** — nothing visual was added anywhere.

## Tests (per phase, committed green)
- `tests/agi/test-capability-router.js` — 15/15 (routing, minimum sets,
  schema sanitization, dispatch seam, lightweight refusal, live weather
  round-trip)
- `tests/agi/test-architecture-upgrade.js` — 17/17 (parallel execution,
  lifecycle, retries, timeout, cancel-discards-late-result, cascade,
  WAITING, backends, provider honesty, snapshot completeness)
- Full chain: `npm test` (extended with both new suites) — see commit
  records for the green run.
- Frontend build: unchanged UI, vite build green.

## Commits
- `2a77c43` — Capability Router + MCP dispatch seam + circuit breaker +
  schema-rich tool directory (smart tool use, fully)
- (this commit) — TaskGraph + ExecutionBackend + ExternalProviders +
  ArchitectureViews + observability APIs + Orca study + docs
