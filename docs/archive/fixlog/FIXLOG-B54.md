# FIXLOG-B54 — Autonomy by Default, No Stalled Turns, Parallel Gates, Honest Verification

Every Priority: before/after evidence + `cd server && npm test` result. Worked top to
bottom; B50–B53 structure was not re-done. This build closes the remaining live-product
failures: trivial acknowledgments re-triggering the previous task, ambiguous references
stalling the conversation, serial review/security passes, per-step sign-off friction, and
unverified builds being reported (and memorized) as clean.

**Final test evidence (each `cd server && npm test` run — all suites):**
```
RESULT: 65 passed, 0 failed   (audit suite, incl. new B54 P4/P5 github autonomy tests)
RESULT: 50 passed, 0 failed   (B53 suite)
... 0 failures in every suite; full run: 0 ❌ total
```

---

## Priority 1 — The pending offer is created ONLY on a real pause

### Problem
`server/index.js` called `saveOffer(convId, effectiveQuery)` on **every** chat turn, right
after planning. Trivial acknowledgments ("ok", "sure", "please", "fine") therefore always
had `hasPending === true` — which made "yes"-style replies re-plan and re-execute the
previous task, and re-ask for information already given.

### Before
```js
// server/index.js (old, ~line 1046)
plan = await planner.analyzeIntent(...);
saveOffer(convId, effectiveQuery);          // ← every turn, even "ok"
```

### After
```js
// server/index.js (new)
plan = await planner.analyzeIntent(...);
// (no saveOffer here — an offer is ONLY created when a run genuinely pauses)
...
onPause: async (pausedState) => {
  saveRun(convId, { plan, query: executionQuery || effectiveQuery, state: pausedState });
  // B54 P1 — the pending offer is created HERE (only for real pauses), so
  // "yes" resumes the actual paused action and nothing else can re-trigger
  // a previous task.
  saveOffer(convId, executionQuery || effectiveQuery);
},
```
The `DECLINE_RE` / `CONFIRM_RE` handlers in `/api/chat` are unchanged (clear/resume from the
same store), so a real pause still resumes at the exact paused node.

---

## Priority 2 — Ambiguous task references DEFAULT to the most recent task (never stall)

### Problem
`ConversationManager.analyzeMessage` returned `classification: 'clarify'` whenever a
reference matched multiple known tasks ("Fix the server" with two server tasks). The user
then had to answer a question the state could already answer — a stall.

### Before
```js
// ConversationManager.js (old)
if (ref.confidence >= 0.4 && ref.candidates?.length) {
  return { classification: 'clarify', taskId: null, confidence: 0.4, reason: ref.reason, candidates: ref.candidates };
}
```

### After
```js
// ConversationManager.js (new) — LangGraph "most recent thread" pattern
if (ref.confidence >= 0.4 && ref.candidates?.length) {
  const pick = bestCandidate(ref.candidates);
  if (pick) {
    const t = getTask(pick.id);
    const isCurrent = t.id === currentTaskId;
    return {
      classification: isCurrent ? 'continue' : 'switch',
      taskId: t.id,
      confidence: 0.6,
      reason: `${ref.reason} — defaulted to the most recent match (${t.title})`,
      ...
    };
  }
}
```
- New `bestCandidate()` sorts candidates by `lastActivity` (most recent wins; falls back to
  the first candidate when activity is missing).
- `DecisionEngine.decide()` keeps a **defensive** clarify branch — reachable only when NO
  usable state exists anywhere — and even then it now lists **real** candidate tasks
  (`listTaskOptions()` via the new `listTasks()` import) and defaults to the most recent
  one instead of asking an empty question.
- **Test updated** (`test-build47.js` TEST 10): now asserts "Fix the server" with two
  server tasks → `switch` to the most recently created task + the decision executes it with
  its context block (wiring matches index.js: `taskId: analysis.taskId || null`).

---

## Priority 3 — Independent read-only gates run CONCURRENTLY

### Problem
`Orchestrator.js` ran the book/library probe, the memory probe, and the reviewer pass
serially; the security pass ran after review in a separate graph, adding a full serial
pass to every build.

### After
- **Research node:** the books/library recall and the semantic-memory probe now run in
  `Promise.all` — both are read-only lookups and either can short-circuit the web search.
- **codeReview node:** `runReviewerPass` and `runSecurityPass` now run in `Promise.all`
  over the same `listWorkspaceFiles()` snapshot; each logs its own verdict.
- **securityGate node:** reuses the already-computed parallel verdict; the B52
  `runReviewSecurityGraph` fix-round runs ONLY when the verdict is `BLOCKED`, with a
  `reviewFn` that replays the parallel review result instead of re-running it. A
  non-standard path (no parallel verdict) falls back to a single `runSecurityPass`.

---

## Priority 4/5 — Autonomy by default; ONE checkpoint, only for irreversible actions

### Problem
Every mutating GitHub action ("create a pull request", "commit") paused for per-step
sign-off. The user explicitly asked for the action; friction without safety value.

### After
```js
// Orchestrator.js — github node
const IRREVERSIBLE_RE = /... (money: pay|buy|$ amounts|currencies) ... |
  (delete|destroy|wipe|erase|drop|force ?push) near (repo|database|account|branch|main|prod) .../i;
if (opts.confirm && IRREVERSIBLE_RE.test(query)) {
  const decision = await opts.confirm({ risk: 'irreversible', node: 'github', action: req.action,
    question: `This is an **irreversible** action ... Say **yes** to proceed exactly as planned, or **no** to cancel.` });
  ...
}
```
Explicitly requested, reversible actions now run directly. Only money-moving or
destructive repo operations get the single `risk: 'irreversible'` confirmation.

- **Test updated** (`test-audit-b47.js`): Case A "check my github connection" runs with no
  confirmation; Case B uses **"force push to main"** (the parser maps it to the mutating
  `push` action and it matches the irreversible regex — "delete the repository" is not a
  supported action in `parseGithubRequest` and falls through to read-only `status`).

---

## Priority 6 — Honest verification: only a clean run is "verified" or memorized

### Problem
Every finished build was reported `verified: true`, claimed "✓ Built." even when the
success predicate never passed, saved its file tree into coding knowledge (so later tasks
would blindly reuse an unverified solution), and the shipper referenced an **undefined
`files`** variable that crashed it into an error message.

### After (`Orchestrator.js` shipper + `index.js`)
- `const files = listWorkspaceFiles()` — the REAL file list (fixes the crash).
- Status line is honest:
  - run clean → `✓ Runs clean.`
  - exhausted attempts → `⚠ Built, but the code did not run clean after N attempts — the last output was: ...`
  - never run clean → `⚠ Built, but not verified to run clean — check the log above.`
- `results.statistics.runClean = c.runSuccess`, `.attempts = c.debugAttempts`, and
  `confidence = c.runSuccess ? 100 : 60` so callers see the real outcome.
- `index.js` marks the task verified only when `results.success === true && results.statistics?.runClean !== false`.
- The terminal checkpoint records the real last error when the build was unclean.
- `saveCodingKnowledge(...)` runs only when `c.runSuccess` is true — an unverified build is
  never stored as a "known solution".

---

## Final state
- `cd server && npm test` → **0 ❌** across every suite (audit 65, B53 50, build47 37, and
  all others).
- Scratch `.b54-*` tooling files removed; only source + test + this log remain.
