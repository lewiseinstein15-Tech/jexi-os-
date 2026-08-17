# FIXLOG-B110 — Plan Mode + Ask User (DeepSeek Harness `plan-mode` + `tool-ask-user`/`user-questions` mirror)

**Phase:** B110 · **Shipped:** 2026-08-17 · **Branch:** main (direct) · **CI:** green · **APK:** rebuilt

## Why
Two interaction capabilities from DSH that JEXI lacked:
- **plan-mode** — the model plans instead of executes; `exit_plan_mode` presents the
  completed plan for user review; implementation begins only after approval;
- **tool-ask-user / user-questions** — the model calls `ask_user_question` when it needs
  confirmation, a choice, or missing information; the tool parks structured questions
  (id/question/header/options/multi_select), the human answers, and the answer feeds
  back into the loop.

## What was built

### `server/src/services/PlanMode.js` (dsh plan-mode mirror)
- Per-conversation state **folded from the conversation log** (`plan/mode` events, last
  one wins — DSH's exact model), so resume/fork restore it.
- `PLAN_POLICY_SECTION` — the plan:policy guidance appended to the prompt while active
  ("do NOT call execution tools yet… exit_plan_mode is the only way to present the plan").
- `presentPlan()` (exit_plan_mode engine) — stores title + steps + markdown in PlanStore
  with `status: 'pending_review'`; `approvePlan()` flips it to `approved`.
- **`/plan on` / `/plan off`** chat commands; the policy section rides the query of every
  run while active; **"yes/approve"** after a presented plan approves it and turns plan
  mode OFF so the resumed run IMPLEMENTS instead of re-planning (the existing
  offer-resume flow re-runs the original task).

### `server/src/services/PendingQuestions.js` (dsh user-questions mirror)
- `askQuestions(convId, questions)` parks ≤5 questions (id, question, header, options
  with label+description, multiSelect); `getPending` / `answerPending` (rejects double
  answers) / `takeAnswers` (one-shot) / `clearPending`.
- `formatAnswers()` renders answers as injected context for the next turn — DSH's
  "the answer becomes an ordinary tool result".

### Tools (registry 191 → **193**, contracts + timeouts)
- **`ask_user_question`** — parked questions + `ask.user` stream event; always available
  to the agent loop AND the SIMPLE-path coworker.
- **`exit_plan_mode`** — presents the plan + `plan.review` stream event.

### API + frontend
- `GET /api/questions/:conv`, `POST /api/questions/answer`, `POST /api/plan/:conv/approve`.
- **ChatWindow cards**: "JEXI NEEDS YOUR INPUT" — each question with option buttons and
  a custom-answer input (answering auto-continues the loop with the answers); "PLAN
  READY FOR REVIEW" — the plan markdown with **APPROVE & START** / **SEND CHANGES**.
- `useJexiEngine` handles `ask.user` / `plan.review` stream events; parked questions
  are re-surfaced after a run completes.

### Tests & fixes
- **`test-plan-mode.js` — 37 checks**: log-backed last-wins state, policy section,
  plan presentation (title/steps/status), approval, question parking/options mapping
  (snake→camel), double-answer rejection, one-shot injection, tools through the gate
  with contracts, too-short plan honesty.
- The roster audit caught a real wiring bug (tool listing a nonexistent agent) — fixed,
  catalog regenerated (193 tools). Counts updated across 6 suites.
- **Full 51-suite sweep exit 0; lint 0 errors.**

## Verification
- `npm test` full sweep: **exit 0** · `eslint`: **0 errors**
- audit-roster: 251 agents · 507 skills · **193 tools** · 100% reachable
- APK rebuilt (frontend changed) → release tag bumped.

## How the user sees it
- Say **/plan on** then give a task: JEXI plans, presents the plan card, and waits —
  tap **APPROVE & START** to implement, or send changes to revise.
- Mid-task, JEXI can now genuinely pause and ask: option buttons + free-text answers
  appear as a card, and her next step uses what you picked.
