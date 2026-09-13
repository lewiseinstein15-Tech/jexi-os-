# Phase 3 Scope B — Legacy File Audit

Audit date: Phase 3, Scope B.
Audit method: full consumer grep (server/, excluding node_modules), plus
module-load probes (node ESM `import()`).

## Result

| File | Consumers | Class | Disposition |
|------|-----------|-------|-------------|
| `server/src/legacy/Coder.js` | none (module fails to load: imports nonexistent `./Architect.js`) | DEAD | **REMOVED** |
| `server/src/legacy/README.md` | none | DEAD | **REMOVED** |
| `server/src/services/AgentRoster.js` | see below | HOT PATH | **KEPT** — no wired replacement; deleting breaks server boot |
| `server/src/services/SkillChain.js` | see below | HOT PATH | **KEPT** — it IS the skill execution engine; no director-side skill assembly exists |
| `server/src/services/ComputerUseAgent.js` | see below | HOT PATH | **KEPT** — used by Orchestrator hot paths (link analysis, computer use) |
| `server/src/services/DesktopManager.js` | see below | HOT PATH | **KEPT** — it IS the real browser runtime (BrowserRouter desktop worker, ComputerOps, Orchestrator) |

## Consumer audit (raw grep)

```
# AgentRoster / AGENT_ROSTER / SKILL_REGISTRY / ROSTER_COUNT / SKILL_COUNT
server/index.js                                9    /api/roster endpoint
server/scripts/audit-roster.js                 5    reachability audit script
server/src/services/AgentRoster.js             8
server/src/services/ArchitectureViews.js       3
server/src/services/JexiIdentity.js            5
server/src/services/Orchestrator.js            1    rosterStats() log line
server/src/services/Planner.js                 3    team composition (getAgent/skillsForTeam/rosterStats)
server/src/services/PluginRegistry.js          3
server/src/services/ProfileCompleteness.js     3
server/src/services/Reachability.js           14    reachability analysis core
server/src/services/SkillChain.js              1
server/src/services/TaskManager.js             3
server/src/services/ToolRegistry.js            1    composeTeam -> toolsForTeam
server/src/services/director/Employees.js      2    comments only (documents inverse contract)
server/test-audit-b48.js                       2    TEST
server/test-b49.js                             5    TEST
server/test-reliability.js                     4    TEST
server/test-roster-skills.js                   6    TEST

# SkillChain
server/index.js                                1
server/scripts/audit-roster.js                 1
server/scripts/gen-plugins.js                  1
server/src/services/AgentRoster.js             2
server/src/services/AutonomousCoding.js        1    runReviewerPass/runSecurityPass dynamic import
server/src/services/Orchestrator.js            1    build/QA/review/security/critic/reflector pipeline
server/src/services/PipelineGraphs.js          1
server/src/services/Planner.js                 1
server/src/services/Reachability.js            3
server/src/services/SkillDiscovery.js          3    server/skills on-disk library loader
server/src/services/SubagentRuntime.js         1    skillWantsIsolation
server/src/services/ToolRegistry.js           68    skill slugs + SKILL_META
server/src/services/ToolRuntime.js             2    fallback loader
server/test-b49.js                             2    TEST
server/test-b52.js                             1    TEST
server/test-skill-progressive.js               1    TEST

# ComputerUseAgent
server/index.js                                1    /coder/ alias comment
server/src/services/ComputerUseAgent.js        6
server/src/services/Orchestrator.js            4    link_analysis + computerUse hot paths
server/src/services/PathSafety.js              1    comment (workspace-writer contract)
server/test-audit-b48.js                       1    TEST
server/test-b52.js                             1    TEST

# DesktopManager
server/index.js                                2    main browser entry + /coder/ route
server/src/services/BrowserRouter.js           5    built-in DESKTOP worker (real Chromium)
server/src/services/DesktopManager.js          1
server/src/services/Orchestrator.js            3    build-mode page nav
server/src/services/SelfMonitor.js             1    browserStatus()
server/src/services/SkillChain.js              2    video QA browser
server/src/services/ToolRegistry.js            6    engine: 'DesktopManager' tool descriptors
server/src/services/TravelBookingAgent.js      1    DI deps.desktopManager
server/src/services/director/ComputerOps.js    5    real browser operations backend
server/test-b212.js                            1    TEST
server/test-browser-verify.js                  2    TEST
```

## Why the four service files stay (plan clause: "do NOT delete — document why")

Scope B step 3 authorises deleting a legacy file only when its consumers are
migrated to an authoritative replacement, or when it has no replacement.
Source audit shows no such replacement is wired:

- AgentRoster: the Phase 2D candidate (`workforce/registry/`) is consumed
  **only** by its own test (`tests/agi/test-worker-registry.js`). The live
  team-composition path (Planner → ToolRegistry → Orchestrator events) still
  calls `AgentRoster.composeTeam`. `director/Employees.js` is the runtime
  roster source for Director execution, but does **not** provide
  composeTeam/skillsForTeam/skillsLine used by the planning layer.
- SkillChain: no director-side skill assembly exists. `SkillChain.loadSkill`
  is the on-disk `server/skills` loader used by SkillDiscovery, ToolRuntime,
  and SubagentRuntime; its per-pass engines (planForBuild, qaWebApp,
  runReviewerPass, runSecurityPass, …) are imported by Orchestrator and
  PipelineGraphs.
- ComputerUseAgent: no browser-runtime replacement for its executeTask
  intent path; Orchestrator constructs it directly for link_analysis and
  computer_use.
- DesktopManager: it **is** the real browser runtime. BrowserRouter's
  built-in DESKTOP worker, director/ComputerOps, SelfMonitor, and
  Orchestrator all import it directly.

Per the plan scope guard, none of these four are removed in Scope B. Their
migration is carried forward (Phase 4) — or they are adopted as permanent
runtime modules under the layered architecture.