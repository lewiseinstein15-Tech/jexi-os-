# Architecture — progressive knowledge (loaded on demand)

How the agent services fit together, and where new capabilities plug in.

## The pipeline

```
User query
  → Planner (server/src/services/Planner.js)
      classify (deterministic regex fast-path → LLM fallback)
      → intent + TEAM_PLAN team + auto tool set (ToolRegistry.toolsForIntent)
  → Orchestrator (server/src/services/Orchestrator.js)
      executePlan: announce team → run steps → gates (QA/Security/Review)
      → skills via SkillChain.runSkill (loads server/skills/<slug>/)
  → memory (MemoryManager) / books (BookLibrary) / search (SearchEngine)
      / browser (DesktopManager) / video (VideoAnalyzer) / …
  → VerificationLoop (critique → revise) → final answer
```

## Where to add things

- **New capability service** → `server/src/services/<Name>.js`, export pure
  functions; import into `server/index.js` routes and/or the Orchestrator.
- **New agent** → AgentRoster (skills must exist) + TEAM_PLAN wiring
  (Planner.js) — otherwise `audit-roster --check` fails CI.
- **New skill** → `server/skills/<slug>/SKILL.md` + `reference.md`
  (progressive folder preferred over a flat .md).
- **New tool** → ToolRegistry entry (slug/desc/agents/engine) — the engine
  string maps to the service that executes it.

## Runtime systems

- **SkillChain** — progressive disclosure: planning sees name+description only;
  SKILL.md + reference.md load at execution.
- **AgentLoop / SubagentRuntime** — tool-calling loop (plan → tool → observe →
  repeat, bounded) and bounded parallel subagents; subagents can declare
  isolation (`context: fork`) so the parent gets only a summary.
- **PluginRegistry / server/plugins/** — plugin packages with `plugin.json`
  that contribute skills/agents; discoverable + toggleable.
- **GraphRunner** — small graph executor: agent/tool/verifier/gate nodes with
  success/retry/fallback outcomes and parallel fan-out/join.
- **Memory** — MemoryManager (long-term key/vector memory + rolling summary),
  TrustedLibrary + BookLibrary (books), knowledge folders (this tree).

## Data locations

- `server/skills/` — skill definitions
- `server/knowledge/` — progressive knowledge folders
- `server/plugins/` — plugin packages
- `server/agents/` — reusable agent definition files
