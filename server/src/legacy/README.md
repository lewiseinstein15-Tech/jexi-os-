# JEXI OS — server/src/legacy/

Quarantine zone for dead code removed from the hot path. Files here are NOT
imported by any live module. Everything here is preserved for history and
reference; do NOT import from it.

## Phase 2 Scope C audit result

### Quarantined (truly dead — zero importers anywhere)

| File | Reason |
|------|--------|
| `Coder.js` | Superseded by autonomous coding loops (`AutonomousCoding.js`, `CodeModeRuntime.js`, `CodingLoop.js`). Static + dynamic import scan: zero importers in `server/`, zero string references. `generateCode()` reached `planProject()` but nothing reached it. |

### Audited — deprecated but LIVE (NOT quarantined)

These were flagged by Phase 0/1 as legacy, but the Phase 2 Scope C audit found
real, reachable importers. Removing or moving them would break the hot path.
They stay in `server/src/services/` until Phase 3 migrates their consumers.

| File | Importer count | Live reach | Verdict |
|------|----------------|-----------|---------|
| `AgentRoster.js` | 18 | `Planner`, `Orchestrator`, `ToolRegistry`, `Reachability`, `TaskManager`, `JexiIdentity`, `PluginRegistry`, `ProfileCompleteness`, `SkillChain`, `ArchitectureViews`, `director/Employees` | Deprecated catalog, still consumed by planner/tool-selection. Keep. |
| `SkillChain.js` | 4 | `Orchestrator`, `PipelineGraphs`, `Reachability`, `SubagentRuntime` | Director-side skill assembly not yet unified. Keep. |
| `ComputerUseAgent.js` | 1 | `Orchestrator` (gated behind computer-use path) | Browser/computer-use agent, reachable only when that path triggers. Keep, migrate later. |
| `DesktopManager.js` | 4 | `ToolRegistry`, `SkillChain`, `SelfMonitor`, `BrowserRouter`, `Orchestrator`, `director/ComputerOps` | Real browser wiring depends on it. Keep. |

### Files that LOOK dead but are dynamically imported (verified LIVE)

`BackgroundJobs`, `GoalTools`, `FileReference`, `TerminalSessions`, `Scheduler`-family,
`OllamaProvider`, `IntentEngine`, `JexiMarketProvider`, `MemoryVault`, `ReasoningEngine`,
`SelfImprovement`, `UserProfile`, `WorkflowEngine`, `PendingQuestions`, `CodeModeRuntime`,
`RalphRunner`, `TaskScheduler` — all reached via `await import()` from `ToolRuntime.js`,
`routes/arena.js`, or `routes/surface.js`.

### Methodology

- Static import graph over every `.js` under `server/` (index.js, routes,
  connectors, services, tests, scripts).
- Dynamic `import('...')` + `require('...')` string resolution.
- Full-text filename scan across `server/` and repo docs to catch string refs.
- Reachability BFS from `server/index.js` for hot-path classification.

## Layer skeleton (Phase 2 Scope C)

The OS layer directories at repo root (`kernel/`, `runtimes/`, `workforce/`,
`router/`, `lsp/`, `mcp/`, `skills/`, `memory/`, `workgraph/`, `verification/`,
`security/`, `events/`, `scheduler/`, `web/`, `context/`, `plugins/`, `ui/`,
`.jexi/`) are README placeholders mapping each target layer to the current
implementation location. The flat `server/src/services/` tree is the current
implementation; Phase 3+ migrates groups into these slots as they are rebuilt.