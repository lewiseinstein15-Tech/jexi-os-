# FIXLOG B208 — THE DIRECTOR: JEXI as the boss of a team of AI employees

**The ask:** USER → JEXI → EMPLOYEES → JEXI → USER. JEXI interprets vague requests,
refines them into proper objectives, plans, staffs employees by capability,
delegates real work with structured briefs, supervises, verifies, recovers,
and reports back in her own voice. Employees are stable identities; models are
swappable infrastructure. No scripted fake conversations.

## Architecture (server/src/services/director/)

| Module | What it actually does |
|---|---|
| `Employees.js` | The identity system. Stable employees (Zola/Forge/Vera/Nyx/Atlas/Echo/Scout/Kito/Ada) with roles, personalities, capabilities, tools, permissions. **No model ids anywhere in identity.** Roster overridable via `data/employees.json`. Capability-driven matching with primary-capability + specialization + support-role tiebreaks, telemetry-biased. |
| `AgentMail.js` | The communication protocol: typed, addressed, task-scoped messages (TASK_ASSIGNMENT / FINDING / RESULT / CORRECTION / VERIFICATION / HANDOFF / FAILURE / RECOVERY / …) with artifacts, priority, parent threading. JEXI is the hub — no free-for-all chat. |
| `ModelRouter.js` | Employee → capability needs → provider preference ladder → model. **Fallback never changes the employee**: quota/503/timeout → MODEL_SWITCHED, same identity, next lane. Ladder exhausted → typed PROVIDER_FAILED. |
| `TaskState.js` | Full state machine (QUEUED→INTERPRETING→PLANNING→ASSIGNING→RUNNING→VERIFYING→COMPLETED/FAILED/BLOCKED, plus RECOVERING/REPLANNING/PAUSED/CANCELLED), illegal transitions throw, everything persisted per conversation, canonical event envelope (id/ts/taskId/agent/type/severity). |
| `EmployeeSession.js` | One employee doing one assignment for real: the structured BRIEF (objective, context, role, task, requirements, constraints, resources, expected output, success criteria, verification requirements, dependencies, priority, time budget, prior results), real tool execution (web-search), routed model call, structured output parsing (REPORT/DELIVERABLE/CONFIDENCE/CLAIMS), artifacts extracted from file blocks. Failure typing: PROVIDER_FAILED / TIMEOUT / BAD_OUTPUT / TOOL_FAILED. |
| `Verifier.js` | Deterministic acceptance gates (empty/refusal/stub detection — no model) + rubric evaluation against the task's own success criteria. Verifier model failure degrades the check honestly (never a silent pass). |
| `Director.js` | The boss loop: UNDERSTAND → REFINE → PLAN → STAFF → DELEGATE → EXECUTE (dependency waves, parallel cap 3) → SUPERVISE (recovery ladder: RETRY → REBRIEF → REASSIGN → handoff → ESCALATE) → VERIFY (correction loop, max 2 rounds) → REPORT (JEXI's voice, format fits the task, credits only what actually ran). Departments: heavy builds delegate to the legacy industrial pipeline under Forge's responsibility. Dangerous+ambiguous → asks instead of guessing. Interpreter unavailable → DECLINES to the legacy pipeline (honest degradation, never fakes understanding). |
| `Telemetry.js` | Observed performance per employee and per provider (success rate, duration, verification pass rate) — adaptive orchestration, NOT claimed training. |
| `RealAdapters.js` | Production wiring: interpret/employee/verify/report over `generateContent`, search over the real `executeTool('web-search')`. All seams are injectable — tests run the REAL orchestration against a controlled model layer. |

## Integration

- `/api/chat`: the Director lane runs after the deterministic utility lanes
  (slash commands, project memory, offers/resume) and before the legacy
  planner path. Guardrail scan runs FIRST (moved up, still covers legacy).
  Director decline/failure → legacy pipeline unchanged — the app never breaks
  because the boss is out. Vision requests decline to the legacy vision path.
- `GET /api/team/status`, `GET /api/team/events?sinceEventId=` — reconnect
  replay of the task record + ordered event history.
- UI: canonical events stream as `{type:'team', event}`; `useJexiEngine`
  reduces them into team state; **TeamLive** renders the boss card + employee
  cards (name primary, status from real events, model lane as secondary
  metadata). Existing thinking panel keeps working via the log mirror.
- Final report streams tokens live (`by: JEXI`).

## Proof

- `server/test-b208.js` — **73/73**, deterministic (injected model layer):
  identity system, protocol, router fallback (identity preserved), state
  machine, briefs, output parsing, artifacts, gates, rubric, the critical
  vague→report loop, proportion (simple→1 employee), quota-failure recovery,
  bad-output rebrief, verification correction loop, honest escalation,
  dangerous-ambiguous blocking, department delegation, honest decline,
  telemetry.
- **Live on the real stack** (390px viewport): "what is the deepest lake…"
  → objective refined → Zola staffed by capability → 2 real web searches →
  delivered on the **OpenRouter lane while Gemini was quota-dead and Groq
  rate-limited** (the ladder routed around it) → verifier passed (score 1.00)
  → JEXI's report, correct answer (Baikal, 1,642 m), 38.5s. Team strip
  rendered live: Zola Working → Delivered, Vera Verifying, 0px overflow,
  0 page errors. Task replay via `/api/team/events` verified.

## Honest limitations

- One Director task record per conversation (chat turns are serialized
  anyway); concurrent conversations each get their own.
- Employee "work" is a model call + search tool; the deep coding pipeline
  runs as Forge's department (the legacy graph), not as per-employee tool
  loops.
- The interpreter is one LLM call — its quality bounds the refinement quality.
- Telemetry biases selection/routing; no actual model training happens and
  none is claimed.
