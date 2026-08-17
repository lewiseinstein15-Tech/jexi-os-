# FIXLOG-B113 — /plan = Plan AND Execute (no approval, no questions, updates stream)

**Phase:** B113 · **Shipped:** 2026-08-17 · **Branch:** main (direct) · **CI:** green · **APK:** rebuilt

## The bug (user report)
"She asks a lot of questions and never does the task. When someone puts /plan she
should plan and do the work — not asking approval or anything else — and make sure I
get an update."

## What changed
`/plan` is now **plan-and-execute**: JEXI plans, then DOES the work automatically in
the same flow — no approval pause, no question cards, no "should I continue".

### Server (`index.js`)
- **`planAutoExecute` flag** per request: while true, the plan-review card is converted
  into a plain update log ("📋 Plan ready — executing now.") — the user is never asked
  to approve; a normal message sent while plan mode is on also auto-executes.
- **`/plan <task>`** (new form): extracts the task, turns plan-and-execute on, and runs
  the task through the pipeline — starting with a "📋 /plan — planning first, then
  executing automatically" update.
- **`/plan`** and **`/plan on`**: same mode, instant confirmation reply, no blocking.
- **`/plan off`**: back to direct execution.
- **Auto-resume after planning**: when the planning turn ends with a presented plan,
  the route auto-approves it, turns plan mode OFF (gate released), resolves the
  ORIGINAL task, and executes it immediately — streaming the planner's plan event, the
  "📋 Plan ready — executing now" log, all agent/tool updates, and the final result.

### Policy + gate (`PlanMode.js`, `ToolRuntime.js`)
- plan:policy now says: plan first, then EXECUTE automatically; do not wait for
  approval; **ask_user_question is disabled** in plan mode (the gate returns "Plan
  mode: do not ask the user — plan and execute automatically."); never promise
  preview links inside the plan ("will be provided with the implementation").
- Execution tools remain disabled only WHILE planning (so she plans first), then the
  auto-resume releases them — the work happens.

### Frontend
- The plan card (now rarely shown, only outside auto mode) says execution continues
  automatically and updates stream below.

## Tests (test-plan-mode.js 73 → 82)
- Policy contains plan-then-execute + automatic + no-questions semantics.
- `ask_user_question` blocked in plan mode; `exit_plan_mode` usable; the gate's refusal
  text tells the model to proceed without asking.
- Full contract: present → auto-approve → gate released → execution allowed.

## Verification
- `npm test` full sweep (51 suites): **exit 0** · `eslint`: **0 errors**
- test-tools / worker-router / api-surface / sessions-b96 green
- APK rebuilt (frontend changed) → release tag bumped.

## How the user sees it
`/plan build me a todo app` → JEXI streams "📋 planning…", shows the plan steps, then
"📋 Plan ready — executing now", builds the app with live agent/tool updates, and the
preview link arrives with the implementation. Nothing to approve, no questions asked.
