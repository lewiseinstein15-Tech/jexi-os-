# FIXLOG-B53 — Product Delivery, Task Isolation, Memory, UI, Zero Process Garbage

Every Priority: before/after evidence (file:line or test snippets) + exact `npm test` command and result.
Worked top to bottom. B50–B52 structure was not re-done; this closes the live-product failures.

**Command run after every priority:** `cd server && npm test`

---

## Priority 1 — Frontend: compact plan, full-width chat ✅

### Before
- `src/components/CommandCenter.jsx:25` — desktop main column was `w-full max-w-[680px]` and the
  wrapper was `justify-center`, so chat content was pinned to a narrow centered strip with big
  empty gutters on large screens.
- The PLAN roster rendered every stage as a chip row (the code team is ~20 agents) — it dominated
  the vertical space above the chat.

### After
- `src/components/CommandCenter.jsx:25-26` — wrapper is `items-stretch h-full min-h-0 px-4` (no
  centering) and the main column is `w-full min-w-0 min-h-0` — chat spans the work surface.
- Compact plan: `COLLAPSED_STAGES = 5` with an expand toggle (`+${hiddenCount} MORE` / `SHOW LESS`,
  ChevronDown/ChevronUp) — lines 28-34, 120-135. Chips reduced to `text-[8px] px-1 py-0.5`, skills
  line hidden while collapsed. Send/stop/scroll untouched (input row unchanged in ChatWindow).

### Evidence
```js
// CommandCenter.jsx before (line 25):
<div className={isDesktop ? 'flex gap-4 items-stretch justify-center h-full min-h-0 px-4' : ...}>
  <div className={isDesktop ? 'flex flex-col gap-3 w-full max-w-[680px] min-h-0' : ...}>
// after:
<div className={isDesktop ? 'flex gap-4 items-stretch h-full min-h-0 px-4' : ...}>
  <div className={isDesktop ? 'flex flex-col gap-3 w-full min-w-0 min-h-0' : ...}>
```
```bash
$ node test-b53.js
✅ P1 CommandCenter no longer constrains the chat to max-w-[680px]
✅ P1 CommandCenter main column spans the work surface
✅ P1 plan header collapses stages by default
✅ P1 collapsed plan shows an expand toggle
✅ P1 smaller plan chips (8px mono)
```
`npm test` → exit 0 (full suite green; B53 block shown above).

---

## Priority 2 — Hard task / product isolation (calculator → calendar bug) ✅

### Root cause (verified in code)
1. `ConversationManager.analyzeMessage` classified a NEW build ("Build an app that tracks my
   calendar events") as **continue**: `resolveTaskRef` matched the OLD task on the generic noun
   "app" (`titleMatch` noun loop, TaskRegistry.js) → same taskId → the previous workspace + task
   context were injected into the new product request.
2. `WORKSPACE_DIR` was a single shared staging area — the calendar build saw the calculator's files
   (`listWorkspaceFiles()` in Orchestrator.js), and the memory shortcut
   (`searchCodingKnowledge` in `codePipeline`, Orchestrator.js ~line 945) could reuse the old
   product's saved solution.

### After
- **Classification** (`src/services/ConversationManager.js:39-48, 128-171`):
  - `NEW_PRODUCT_RE` — a fresh build+deliverable phrase; `MODIFY_RE` — add/change/update/fix language.
  - `refersToActiveTask()` — only an explicit title/product mention counts as the same task.
  - Fresh-build messages reject **loose generic-noun refs** (conf 0.55–0.84, no product word) →
    classified `new` with `taskId: null`; modification language with an active product →
    `continue` on the SAME taskId.
- **Per-task workspaces** (`src/services/WorkspaceRuntime.js:32-101`): `WORKSPACE_DIR` stays the
  ACTIVE task's staging area (preview links unchanged), archived per task under
  `DATA_DIR/task-workspaces/<taskId>/`. `activateTaskWorkspace()` archives the previous owner,
  clears, restores the target task's snapshot (or empty for a new product);
  `archiveTaskWorkspace()` snapshots on completion.
- **Wiring** (`server/index.js`): before any file-touching node runs, code/compound turns call
  `activateTaskWorkspace(activeTaskId)`; after the run, `archiveTaskWorkspace(activeTaskId)` when
  files were produced (lines ~1081-1086, ~1143-1147). The orchestrator receives
  `taskId` + `isContinuation` (lines ~1122-1134).
- **Memory-reuse gate** (`src/services/Orchestrator.js:958-975`): `searchCodingKnowledge` only
  fires for continuation turns (`isContinuation`) or direct executor calls without a task — a
  brand-new product NEVER inherits another task's saved solution.
- `TaskRegistry` tasks gained `entryPoint` (line 74) so "continue/go back" resumes the exact file.

### Evidence
```bash
$ node test-b53.js
✅ P2 task1 created
✅ P2 calendar request classifies as new (not continue)
✅ P2 "add dark mode to the calculator" stays on the same task
✅ P2 "change the button color" stays on the same task
✅ P2 "go back to the calculator" resolves to the calculator task
✅ P2 calendar objective got its OWN taskId
✅ P2 task2 context block does NOT list task1 files
✅ P2 calendar task workspace is fresh (no calculator.html)
✅ P2 switching back restores calculator.html
✅ P2 calculator workspace does not contain calendar.html
```
`npm test` → exit 0.

---

## Priority 3 — Modification path: apply changes, do not research the word "change" ✅

### Before
"add dark mode to the calculator" / "change the button color" — `isCoding()` has no
add/change/update verb, so the deterministic cascade fell through to `learning_research` (Planner
default) and the LLM classifier had no guidance → JEXI could web-search the dictionary meaning of
"change".

### After
- `src/services/Planner.js:482-488` — new rule 6.1: `MODIFY_LANG` + `opts.activeTaskId` →
  `code_task` (coder/runner/debugger/qa/reviewer/memory) — *apply the edit to the existing
  workspace*. Never research/direct_answer.
- `src/services/Planner.js:351-360` — the LLM classifier prompt now receives the active-task note
  ("add …/change …/make the … means EDIT that product → code_task, never research") plus negative
  few-shots ("add dark mode to the calculator" → code_task).
- `server/index.js:1044` — `analyzeIntent` receives `activeTaskId: currentTaskId || null`.
- With **no** active product task the modify phrase is NOT routed to research (falls to a normal
  fresh-task flow per the directive).

### Evidence
```bash
$ node test-b53.js
✅ P3 "change the button color" + active task → code_task
✅ P3 "add dark mode…" + active task → code_task
✅ P3 "now also add…" + active task → code_task
✅ P3 no active task → never research (no web-search of the word)
```
`npm test` → exit 0.

---

## Priority 4 — Product-only final answers (zero process garbage) ✅

### Before
- `N.shipper` (Orchestrator.js) built a giant report: `### 💻 BUILD READY` + QA REPORT + REVIEW
  NOTES + SECURITY REVIEW + REFLECTION + BUILD PLAN + full inline file dumps + test output. That is
  process garbage as the chat answer body.
- `AnswerSanitizer` didn't know pipeline completion lists, "Team: Product → …", critic/reflector
  essays, or "this was a bug I corrected".

### After
- **Shipper template rewrite** (`src/services/Orchestrator.js:1234-1290`): product-first mandatory
  structure — short status line ("✅ Calculator web app is ready."), one-line status, live-preview
  link, file list (download/view links), optional one-line gate note. QA/Review/Security/Reflection
  essays and inline dumps are GONE from the user message (still logged + stored internally).
- **AnswerSanitizer** (`src/services/AnswerSanitizer.js`): new forbidden phrases — "this was a bug
  I corrected", "(the )?(QA|Security|Reviewer|Critic|Reflector) (team )?(found|flagged|reported)",
  "all agents (completed|finished…)", "the full (agent )?(team|pipeline)…", "mission complete";
  new line strippers for `Completed:|Done:|Finished:|Team:|Pipeline:` …→… and
  `Critic/Reflector/Reviewer/QA/Security notes|verdict|review|report|essay|reflection: …`; headers
  `JEXI TEAM — …` / `AGENT PIPELINE …` removed.
- The responder node (line ~320) already runs the sanitizer as the single choke point for every
  user-facing summary.

### Evidence
```bash
$ node test-b53.js
✅ P4 pipeline completion list stripped
✅ P4 team org-chart line stripped
✅ P4 "this was a bug I corrected" stripped
✅ P4 reflector essay line stripped
✅ P4 agent-team narration stripped
✅ P4 product content survives (status + preview + files)
✅ P4 containsForbiddenNarration flags pipeline lists
✅ P4 containsForbiddenNarration flags critic essays
✅ P4 shipper uses the product-first template
✅ P4 old build-report header gone
✅ P4 QA/REVIEW essay sections gone from the final message
```
`npm test` → exit 0.

---

## Priority 5 — Memory architecture: working / episodic / semantic separation ✅

### Before
- `semanticRecall` searched `codingKnowledge` and returned full code summaries (with file bodies)
  into planner/conversation context — product source trees could leak across unrelated tasks.
- No explicit task-scoped episodic surface.

### After
- **Three scopes documented + enforced in code:**
  - *Working*: current task plan/files/errors — `TaskRegistry` per-task state (taskId-scoped),
    `taskContextBlock` (line ~316) / `taskEpisodicSummary` (`TaskRegistry.js:351`) — strictly the
    task's own fields.
  - *Episodic*: per-task history — `TaskRegistry` `result`, `decisions`, `recentQueries`,
    `completedSteps`, `filesChanged`, `entryPoint`, `checkpoint` — retrieved only when continuing
    that taskId.
  - *Semantic*: cross-task preferences/facts — `MemoryManager.userFacts` / `PreferenceLearner`.
- `semanticRecall(query, { noCode })` (`MemoryManager.js`) — when `noCode` is set the coding
  store is excluded. Wired into `conversationContext` (Orchestrator.js:108) and
  `buildPlannerMemory` (index.js:860) — the planner and chat context NEVER see another task's
  source tree; preferences/facts still cross tasks.
- On task completion the task keeps a short episodic result (status line + file list + preview),
  not full file bodies in semantic memory.

### Evidence
```bash
$ node test-b53.js
✅ P5 semantic recall (with code) can find the probe
✅ P5 noCode semantic recall excludes product code bodies
✅ P5 episodic summary carries only THIS task state
✅ P5 episodic summary excludes other tasks
✅ P5 unknown task has no episodic state
```
`npm test` → exit 0.

---

## Priority 6 — Durable checkpoints + connection-failure recovery ✅

### Before
- `TaskRegistry` tasks had no checkpoint field; a mid-build disconnect had nothing durable to
  resume from except the final result store.

### After
- **Durable checkpoints** (`TaskRegistry.js:137-153`): `setTaskCheckpoint(id, { node, attempt,
  lastError, files })` persists into `task-registry.json` (survives restarts).
- Orchestrator writes checkpoints at the major code nodes when a taskId is in scope
  (`Orchestrator.js:977` codePipeline, `:1065` debugger — exact attempt + last observed error, and
  `:1275` shipper).
- `taskContextBlock` (TaskRegistry ~line 340) now includes the checkpoint line ("Checkpoint:
  debugger (attempt 3) — last error: …"), so a continue/retry knows exactly where execution
  stopped — it never invents completed steps and never re-injects unrelated task artifacts.
- Resume after stream drop still rides the existing `/api/chat/result` store; the task checkpoint
  is the durable layer that survives restarts.

### Evidence
```bash
$ node test-b53.js
✅ P6 checkpoint write returns the checkpoint
✅ P6 checkpoint persisted on the task
✅ P6 resume context exposes the checkpoint
✅ P6 resume does not re-inject unrelated artifacts
```
`npm test` → exit 0.

---

## Priority 7 — Graph + loop: no escape, learn from exact failures ✅

### Before
- `CodingLoop.defaultFixer` prompt fed the last error but nothing about the failure history, and
  had no explicit scope-discipline instruction — a retry could "fix" by inventing unrelated scope.
- Graph gates (codeGateGraph / researchVerifyGraph / reviewSecurityGraph) were confirmed wired in
  B52 and remain wired (verified: Orchestrator still routes through PipelineGraphs).

### After
- `CodingLoop.js:77-90` — `defaultFixer` now receives `failureHistory` and the prompt includes the
  failure-history tail plus the hard rule: "Fix THE ERROR ABOVE and nothing else. Do not expand
  scope, do not add unrelated features, do not rewrite working parts."
- `CodingLoop.js:172-173` — every fix iteration passes the exact previous output + attempt history.
- Identical repeated failure still escalates at 3 identical errors (B51 P5 guard, re-verified) —
  no infinite blind loop.

### Evidence
```bash
$ node test-b53.js
✅ P7 second iteration received the first error text
✅ P7 fixer received the failure-history tail
✅ P7 retry prompt forbids scope expansion
✅ P7 retry prompt names the exact error
✅ P7 identical failure escalates instead of looping forever
```
(`test-b52.js` P7 identical-error guard + B51 suite also green under `npm test`.)

---

## Priority 8 — Response agent behaviour (OS product agent, not chatbot) ✅

### After
- `server/knowledge/JEXI.md` — new always-on rules 8/9/10: task isolation, product-first answers,
  memory scopes.
- `server/src/services/RESPONSE_VOICE.md` — sections 5 (Product-first delivery: banned
  "Completed: Product → …" / "Team: …" / reflection essays / build diaries; required short status +
  preview + files + one-line test) and 6 (modification requests edit the product, never research
  the words).
- `server/src/services/Groundedness.js` — `VOICE_RULES` (embedded in every system prompt) now
  carries the B53 PRODUCT-FIRST rule and the ban on org-chart narration.
- The shipper template from P4 IS the product-first final message; live agent chips stay in the
  plan/activity UI only.

### Evidence
```bash
$ node test-b53.js
✅ P8 JEXI.md has task-isolation rule
✅ P8 JEXI.md has product-first rule
✅ P8 RESPONSE_VOICE.md has product-first delivery
✅ P8 RESPONSE_VOICE.md bans pipeline play-by-play
✅ P8 VOICE_RULES embeds PRODUCT-FIRST
✅ P8 VOICE_RULES bans org-chart narration
```
`npm test` → exit 0.

---

## Final verification

```bash
$ cd server && npm test ; echo "EXIT CODE: $?"
# 23 suites, every RESULT line "0 failed" — exit code 0
$ node test-b53.js
=== RESULT: 50 passed, 0 failed ===
```

**Non-negotiable invariants after B53 — all verified:**
1. Different product request → different taskId → no artifact bleed (P2 tests).
2. "Add/change X" on active app → edit the app, never research the word (P3 tests).
3. Final chat answer = product + minimal status, never agent postmortem (P4 tests + shipper template).
4. Chat layout uses the work surface; plan header stays compact (P1 source checks).
5. Memory scopes do not mix product trees across unrelated tasks (P5 tests).
6. Disconnect → resume from checkpoint, no invented completion (P6 tests).
7. FAIL → exact error in next attempt → verify again, bounded (P7 tests).
