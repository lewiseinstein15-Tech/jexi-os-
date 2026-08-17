# FIXLOG-B115 — Workflow Engine + Subagent Control (DeepSeek Harness `workflow` + `tool-subagent-control` mirror)

**Phase:** B115 · **Shipped:** 2026-08-17 · **Branch:** main (direct) · **CI:** green · **APK:** rebuilt

## Why
Two remaining DSH orchestration capabilities, pulled from their source
(`packages/workflow/workflow` + `workflow-worker-thread` + `tool-workflow` and
`packages/subagent/tool-subagent-control`):
- **Workflow** — the model writes a plain-JS orchestration script that fans work out
  across subagents with phases and structured results, run in an isolated VM realm.
- **Subagent control** — `send_message` (message a background subagent; it becomes its
  next turn) and `interrupt_agent` (request cancellation of a current turn).

## What was built

### `server/src/services/WorkflowEngine.js` (dsh workflow/worker-thread mirror)
- `startWorkflow({ script, meta, args, maxTotalAgents, signal, onEvent })` — compiles
  the script FIRST (`SCRIPT_PARSE` thrown synchronously before a run exists), validates
  the meta block (`META_INVALID`), then executes in an isolated `vm` realm with the DSH
  globals: **`agent(prompt, {instructions?, depth?})`**, **`parallel([thunks])`**
  (bounded slots), **`pipeline(items, ...stages)`**, **`phase(title)`**, **`log(msg)`**,
  **`args`**.
- Result contract (DSH WorkflowRun): `{ value, stopReason: completed|error|cancelled,
  error?, agentsStarted }` — **never rejects**.
- Error discipline (DSH WorkflowError codes): SCRIPT_PARSE, META_INVALID,
  INVALID_ARGUMENT, AGENT_CAP (deployment ceiling, per-run `maxTotalAgents`),
  AGENT_START, AGENT_RESULT, RESULT_UNSERIALIZABLE (strict JSON — functions/
  undefined rejected, DSH semantics), CANCELLED.
- Observe-only events: `workflow/start|end|phase|log|agent-start|agent-end`; run
  records (`workflowRecord`, `listWorkflows`) for inspection; cancellation bridge from
  the caller's AbortSignal.

### `workflow` tool (registry 193 → **196**, tier exec, 240s)
- Args: `script` + `meta` (name kebab-case/description/whenToUse/phases) + `args` +
  `maxTotalAgents` — real schemas so providers keep them.
- Streams phase/log/subagent events as live agent logs; output contract
  `{kind:'workflow', runId, agentsStarted, stopReason, result}`; honest failures with
  the DSH error codes.

### Subagent control (dsh tool-subagent-control mirror)
- `BackgroundJobs.sendMessageToJob(id, message)` → `{messageId, status}` — queued jobs
  get the instruction appended; running jobs park the message (delivered when the
  current turn finishes — DSH wording); finished jobs ack with a note.
- `BackgroundJobs.interruptJob(id)` → `{accepted}` — aborts the job's controller
  (interrupted); already-finished = accepted no-op (DSH semantics).
- Tools `send_message` (`{subagent_id, message}` → `{messageId}`) and
  `interrupt_agent` (`{agent_id}` → `{accepted}`), both with contracts + schemas.
- All three tools are always available in the agent loop (workflow's description
  carries DSH's usage guidance: only for explicitly-requested large orchestration).

## Tests — `test-workflow.js` (35 checks)
- Registry (196) + schema emission; script execution with all globals (agentsStarted=4
  incl. parallel, pipeline stages, args); events; run records; META_INVALID /
  SCRIPT_PARSE synchronous throws; RESULT_UNSERIALIZABLE (functions now rejected);
  AGENT_CAP; aborted signal settles (never hangs); the workflow tool through the gate
  (runId + result, honest failures); send_message / interrupt_agent through the gate
  with DSH contract shapes + not-found honesty.

## Verification
- `npm test` full sweep (53 suites): **exit 0** · `eslint`: **0 errors**
- Counts updated across 7 suites; AGENT-CATALOG regenerated (196 tools)
- audit-roster: 251 agents · 507 skills · **196 tools** · 100% reachable
- APK rebuilt (frontend unchanged; workflow tool is model-facing only).

## How the user sees it
Ask JEXI for "a workflow" or large multi-agent orchestration: she writes a script
(`agent()/parallel()/pipeline()/phase()`) that fans out dozens of subagents with live
phase updates, and returns one structured JSON result. Background subagents can be
messaged (`send_message` — new instructions become their next turn) and interrupted
(`interrupt_agent`) mid-run.
