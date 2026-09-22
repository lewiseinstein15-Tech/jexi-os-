# FIXLOG B137 — "Pull the all": approval, permission presets, subagent report, personas, runtime views, examples, test-support

**Date:** 2026-08-18 · **Repo:** lewiseinstein15-Tech/jexi-os- · **Branch:** main

The user said **"Pull the all"** — another DSH batch, all JEXI-branded.

---

## What landed

### 1. `interaction/user-approval` → `UserApproval.js`
- Per-session approval policy, **log-backed** (last `approval/policy` event wins): `ask` (default — external/irreversible actions pause for ONE explicit approval) vs `never` (proceed within the sandbox).
- **Wired into ToolRuntime's external tier**: with `never`, external-tier actions skip the pause; the default `ask` keeps today's behavior exactly.

### 2. `interaction/permission-presets` → `PermissionPresets.js`
- Four named bundles over the sandbox × approval knobs: `assistant` (workspace-write + ask), `autonomous` (workspace-write + never), `sandboxed` (read-only + ask), `full-access` (danger-full-access + ask).
- Selecting a preset records a durable `permission/preset` event AND writes both knobs through their canonical setters; the effective preset is folded (or `custom` when knobs don't match a bundle).
- `GET /api/permissions?conv=`, `POST /api/permissions` (preset or approval).

### 3. `subagent/tool-subagent-report` → `SubagentReport.js` + registry tool `report`
- Child-scoped `report` tool: only callable inside a subagent run (engine fails closed otherwise); delivers a self-contained report to the parent; reporting never ends the child's turn.
- SubagentRuntime opens a per-run report channel, threads `subagentId` through AgentLoop → executeTool, collects reports, and folds them into the parent-visible aggregate (single-subagent path prefers explicit reports).
- Children get the DSH report guidance appended to their system prompt.
- Registry **206 → 207 tools**; schema + output contract + `GET /api/report/channels`.

### 4. `preset/persona` + `agent-presets` → `PersonaManager.js`
- Personas: `jexi` (default), `concise`, `mentor`, `code-specialist` — flavor overlays composed on top of the active preset at the −30 flavor position.
- User personas in `DATA_DIR/personas.json` merge over built-ins (built-ins can't be overridden); the `x-jexi-persona` request header selects one per chat.
- `GET /api/personas`, `POST /api/personas`.

### 5. `schedule/schedule` (runtime view) → `ScheduleRuntime.js`
- Read-side view of TaskScheduler: cadence, next/last run, status, counts — public fields only.
- `GET /api/schedule/runtime`.

### 6. `host/webserver` + `frontend-static` + `api/gateway` → `HostStatus.js`
- Host facts (uptime, memory, load, static frontend availability) and the gateway surface (open unauthenticated paths, key-lock state).
- `GET /api/host`, `GET /api/gateway`.

### 7. `examples/` → `server/examples/README.md`
- JEXI examples mirror: headless one-shot, JSON-RPC/ACP demo, agent-spine demo, ACP demo, permission presets + personas.

### 8. `test-support/llm-replay` (+ `llm-mock-server`) → `server/test-support/llm-replay.js`
- Deterministic offline LLM provider for tests: sequence/match modes, call recording, scripted errors, reset.

## Verification
- `npm test` — **exit 0, 67 suites green**, incl. new `test-dsh-batch6.js` (~75 checks: approval policies, preset bundles + knob folds, report tool fail-closed + delivery, personas, schedule runtime, host/gateway, llm-replay, examples).
- Registry count assertions updated **206 → 207** across 12 suites.
- `AGENT-CATALOG.md` regenerated: **252 agents · 508 skills · 207 tools · 100% reachable**.
- `eslint` — 0 errors, 0 warnings in new files.
- Boot smoke test: all new endpoints live; `POST /api/permissions {preset: autonomous}` correctly folds sandbox=workspace-write + approval=never.
