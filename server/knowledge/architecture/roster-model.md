# Roster & execution model

Load this folder when the task is about which agents exist, who runs for an intent, or why the catalog says what it says.

## The catalog
- 206 agents · 492 skills · 152 tools. TEAM_PLAN (single team map) says which agents run per intent; `composeTeam()` delegates to it.
- Every roster entry carries a `tier`: `core` (5 brain agents) / `pipeline` (own graph-node pass) / `team` (composed; possibly bundled).
- The audit (`cd server && npm run audit-roster`, wired into `npm test`) fails CI on any orphan or dangling reference. AGENT-CATALOG.md is generated from the live registries.

## Execution model (who actually reasons)
- **Independent** — the agent takes its own observable turn with its own verdict (product/designer/engineer calls, architect/coder/debugger codegen+fix, runner execution, and the QA/Reviewer/Security/Critic/Shipper/Reflector gate nodes).
- **Bundled** — persona folded into a composite prompt (honestly tagged "· composed" in the PLAN view).
- The plan event carries `execution: { independent, bundled }` so the UI never overclaims.
