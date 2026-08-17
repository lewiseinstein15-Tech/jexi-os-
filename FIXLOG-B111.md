# FIXLOG-B111 — Plan Mode Enforcement (no preview-link promises, no execution before approval)

**Phase:** B111 · **Shipped:** 2026-08-17 · **Branch:** main (direct) · **CI:** green · **APK:** rebuilt

## The bug (user report)
In plan mode JEXI said "I can provide a preview link" — but plan mode is supposed to be
plan-only. Root cause: plan mode was **prompt guidance only** — the model could promise
runtime artifacts AND actually call execution tools (builders, preview servers,
browsers) before the user approved anything.

## What was fixed

### 1. Plan mode is now ENFORCED (hard gate), not just a hint
- **`PlanMode.planModeBlocked(slug, args, convId)`** — while plan mode is active for a
  conversation, execution-capable tools are **refused by the runtime**:
  - the explicit execution set: `code-run`, `code-write`, `code-fix`, `run_code`,
    `preview-server`, sandbox tools, `build-check`, `test-automation`, `lint-check`,
    `security-scan`, `run_in_background`, `link-open`, `browser-drive`, `tab-manage`,
    `form-fill`, `universal-link`, `github-cli`, `deploy`, `email-send`, `computer-use`;
  - tier-based: any tool classified `exec` / `external` / `risky`.
- **ToolRuntime** checks the gate (conversation id comes through `spillOwner`) and
  returns `{ ok:false, blocked:true, planMode:true, error:'Plan mode is active —
  execution tools are disabled until you approve the plan…' }` with `tool.refused` +
  `tool.result` events. Read tools (memory/knowledge/search) and the planning tools
  (todo, plan, ask_user_question, exit_plan_mode) stay fully usable.
- Approval flow unchanged: "yes/approve" turns plan mode OFF before the resumed run, so
  implementation (and the preview link) works immediately after approval.

### 2. No premature artifact promises
- **plan:policy section** now explicitly forbids promising runtime artifacts while in
  plan mode: "NEVER promise preview links, deployed apps, generated files, screenshots…
  You may say: 'After you approve, I will build it and provide a live preview link.'"
- The `exit_plan_mode` result note and the `/plan on` reply state the same rule.
- The plan card in the app shows: "Implementation and the live preview link arrive
  after you approve — nothing is built while the plan is pending."

### Tests (test-plan-mode.js 37 → 52 checks)
- `planModeBlocked`: code-run / preview-server / run_code / link-open / github-cli
  blocked; memory-recall / skill-search / exit_plan_mode usable; no conversation → no
  blocking; mode off → allowed again.
- **Through the gated runtime**: code-run and preview-server refused with
  `planMode:true` + clear error while on; memory tools still execute; after mode off,
  execution works (full profile satisfies the separate permission gate).

## Verification
- `npm test` full sweep (51 suites): **exit 0** · `eslint`: **0 errors**
- test-tools / sessions-b96 / worker-router / compaction / api-surface all green
- APK rebuilt (frontend changed) → release tag bumped.

## How the user sees it
`/plan on` → JEXI can only plan: execution tools are refused server-side (not just
discouraged), she no longer promises preview links before approval, and the plan card
says the link arrives after you approve. Approve → plan mode off → she builds and the
live preview link shows up with the implementation.
