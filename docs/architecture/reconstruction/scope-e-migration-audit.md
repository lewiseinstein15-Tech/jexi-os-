# Phase 4 Scope E — Legacy Module Migration Audit

Audit date: Phase 4, Scope E.
Spec: migrate 4 retained hot-path modules to named targets, delete after verified.
Audit method: full consumer greps (server/, excluding node_modules), target-API
surface comparison, module-load probes (`node import()`), and the Phase 3
carry-forward record (`docs/architecture/reconstruction/scope-b-legacy-audit.md`).

## Result

| File | Spec target | Verdict | Reason |
|------|-------------|---------|--------|
| `server/src/services/AgentRoster.js` | `workforce/registry/index.js` + `router.js` | **KEPT** | Target exposes NONE of this API; 11 prod importers; deleting breaks server boot |
| `server/src/services/SkillChain.js` | `server/src/skills/` (Scope B) | **KEPT** | Scope-B skills is catalog/loader/curator only — no execution engines; this module IS the engine |
| `server/src/services/ComputerUseAgent.js` | `director/ComputerOps.js runBrowserRound` via `UnifiedTools.js` | **KEPT** | Target is a line-oriented executor, not an `executeTask` agent; Orchestrator + test-audit-b48 depend on it |
| `server/src/services/DesktopManager.js` | adopt as permanent | **ADOPTED** | Already the de-facto runtime; header updated; browser tool domain wired to it |

## File 1 — AgentRoster.js (1010 lines)

Target API (`workforce/registry/index.js` + `router.js`): `DESC_BUDGET_TOKENS`,
`OVERLAP_THRESHOLD`, `truncateToBudget`, `catalogTokens`, `computeOverlap`,
`registerAll`, `ensureIndex`, `getByAgentId`, `findByCapability`, `listAgents`,
`validateOverlaps`, `checkCatalogBudget`, `classifyRequest`, `resolveAgent`,
`routeRequest`, `codingAgents`. Built over `director/Employees.js` (the Director
runtime roster).

Required API: `AGENT_ROSTER`, `SKILL_REGISTRY`, `ROSTER_COUNT`, `SKILL_COUNT`,
`getAgent`, `getSkill`, `agentSkills`, `composeTeam`, `skillsForTeam`,
`rosterSummary`, `rosterFor`, `skillsFor`, `skillsLine`, `rosterStats`.
Target provides **zero** of these.

Direct importers (11): Planner, ToolRegistry, Reachability, ProfileCompleteness,
TaskManager, PluginRegistry, JexiIdentity, Orchestrator, ArchitectureViews,
SkillChain, verification/AgentVerifier. Plus `server/index.js` (/api/roster,
boot). Module-load probe: loads 252 agents / 508 skills, `composeTeam` function.

## File 2 — SkillChain.js (476 lines)

Target API (`server/src/skills/`): `parseFrontmatter`, `slugify`, `readMeta`,
`catalog`, `catalogEntry`, `catalogSystemPrompt`, `readSkill`,
`readSkillAsync`, `STALE_DAYS`, `DEDUPE_THRESHOLD`, `cosineSimilarity`,
`recordSkillUsage`, `reviewDraft`, `archiveStaleSkill`, `restoreSkill`,
`runCurator`. Progressive-disclosure catalog/loader/curator — **no execution
engines**.

Required API: `runSkill`, `loadSkill`, `planForBuild`, `qaWebApp`,
`qaScripted`, `runReviewerPass`, `runSecurityPass`, `runCriticPass`,
`runShipperPass`, `runReflectorPass`, `reviewAndShip`, `fixFromQA`,
`skillMeta`, `skillWantsIsolation`, `planningSkillSummaries`, … Scope-B skills
provides **none** of these.

Consumers: Orchestrator (build/QA/review/security/critic/reflector pipeline),
PipelineGraphs, ToolRuntime, SubagentRuntime, SkillDiscovery, AutonomousCoding,
ToolRegistry (68 skill-slug tools), Reachability. Module-load probe: all pass
engines load as functions.

## File 3 — ComputerUseAgent.js (457 lines)

Target API: `runBrowserRound({ lines, emit, identity })` — executes a bounded
list of pre-parsed browser action lines, then observes. It is a **low-level
executor**, not an LLM-driven agent.

Required API: `new ComputerUseAgent().executeTask(task, sendEvent, { intent:
'link_analysis' | 'computer_use' | 'research' })` — full natural-language task →
browser plan → executed actions → synthesized `###`-headed answer, with
server-side-read and search-team fallbacks. Orchestrator calls this at 3 sites
(lines 622, 646, 782). `test-audit-b48.js` additionally asserts the file
contains its observe-act-VERIFY loop (`verify`, `before.snapshot`). No
equivalent `executeTask` exists in the target.

## File 4 — DesktopManager.js — ADOPTED (permanent)

Already the real Chromium/Playwright runtime behind BrowserRouter's desktop
worker, director/ComputerOps, SelfMonitor, Orchestrator, and index.js. Per the
Scope E instruction it is adopted as permanent; the PHASE-3 TODO header was
replaced with an adoption note. The `tools/domains/browser/` stubs
(`nav_navigate`, `nav_click`, `nav_type`, `nav_extract`) now wire their engines
to DesktopManager (shared-browser singleton, agent-scoped tabs) instead of
throwing "engine not configured"; the browser domain was added to
`registerAllDomains()`. No import cycle (DesktopManager imports only `config.js`).

## Guard clause applied

Scope E: "If a consumer cannot be migrated because no replacement is ready, do
NOT delete the file. Document why and keep it." Files 1-3 are hot-path modules
whose named replacement targets are not functional equivalents. Deleting them
would break server boot, the skill-execution engine, and three Orchestrator
hot-path intents respectively. They are kept, and each file header now records
the re-audit verdict.