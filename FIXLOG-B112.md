# FIXLOG-B112 — Plan Approval Actually Builds (approval resumes the ORIGINAL task)

**Phase:** B112 · **Shipped:** 2026-08-17 · **Branch:** main (direct) · **CI:** green · **APK:** rebuilt

## The bug (user report)
"Still not working — she is not actually built it."

Root causes found in the code:
1. **Approval never resumed anything.** The frontend's APPROVE button called the API and
   sent "approve the plan" as a chat message — but:
   - `CONFIRM_RE` (yes/go ahead/do it…) had **no "approve" branch**, so the message was
     analyzed as a brand-new query ("approve the plan" ≈ intent classification) and the
     pipeline answered that phrase instead of building;
   - the classic resume path also required `hasPending` (a saved offer), and **no offer
     was saved when the model presented a plan** via `exit_plan_mode` — so even a "yes"
     had nothing to resume.
2. **The plan/ask tools had no argument schemas.** `exit_plan_mode` and
   `ask_user_question` fell back to an empty parameter schema, so providers could strip
   the `plan`/`questions` payloads — the plan presentation itself was fragile.

## What was fixed
1. **`APPROVE_PLAN_RE`** (PlanMode, exported): matches `approve`, `approved`,
   `approve the plan`, `yes approve`, `start`, `implement`, `proceed with the plan`,
   `build it now` — typed or from the card button. Non-approvals ("approve the merger",
   "implement this feature") correctly rejected.
2. **The chat route now handles approval directly** (no `hasPending` dependency):
   if a plan is `pending_review`/`approved`, it approves (idempotent), turns plan mode
   OFF (gate released), resolves the ORIGINAL task from the saved offer (fallback: the
   last real user task message — approval utterances and /plan commands are skipped),
   re-plans it via `planner.planConfirmed`, and falls through to EXECUTION — the app
   gets built and the preview link appears.
3. **Plan presentation saves the resume offer**: after a run whose plan is
   `pending_review`, `saveOffer(convId, raw)` is called — so "yes"/"approve" always has
   the original task to resume.
4. **Argument schemas** for `exit_plan_mode` (`plan` required) and `ask_user_question`
   (`questions` required) in TOOL_SCHEMAS + the SIMPLE-path def — providers now keep
   the payloads, and `buildNativeSchemas` emits them.

## Tests (test-plan-mode.js 52 → 73)
- APPROVE_PLAN_RE: 9 approval utterances match, 4 lookalikes rejected.
- TOOL_SCHEMAS declares plan/questions args; buildNativeSchemas emits them.
- Full contract: present → pending_review → approve → approved + gate released →
  execution allowed again.

## Verification
- `npm test` full sweep (51 suites): **exit 0** · `eslint`: **0 errors**
- test-tools / worker-router / api-surface / sessions-b96 green
- APK rebuilt (frontend unchanged this phase; backend-only) — APK tag still bumps via
  the workflow when frontend files change; this phase is backend-only.

## How the user sees it
`/plan on` → task → plan card → **APPROVE & START** (or type "approve") → JEXI re-runs
your ORIGINAL request with plan mode off → the app is actually built and the live
preview link arrives with the implementation.
