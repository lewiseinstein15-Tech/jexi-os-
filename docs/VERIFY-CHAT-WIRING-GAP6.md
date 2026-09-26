# VERIFY-CHAT-WIRING-GAP6 — GAP 6 RE-VERIFY (SINGLE-WRITER DEDUP)

- **Verifier**: GLM (independent — Builder ≠ Verifier; Arena built cb94d04a, GLM verified)
- **Date**: 2026-09-26 (UTC+8)
- **Under test**: Arena's GAP 6 v2 fix — "single user-entry writer" — commit `cb94d04a` on `fix/chat-wiring-completion`
- **Prior finding**: FAIL (2 user entries per turn in 2/3 sessions, non-deterministic — composed `executionQuery` sailed past the exact-text guard)
- **Scope**: Gap 6 ONLY (all other gaps already passed prior verification)
- **Probe independence**: probe written fresh for this verify (`/home/z/my-project/scripts/verify-gap6-probe.mjs`, kept OUTSIDE the repo). Arena's `scripts/chat-dedup-test.mjs` was NOT reused, NOT executed.

---

## P1 — STEP 0 refs + base SHA

```
$ git fetch origin
$ git checkout fix/chat-wiring-completion
Switched to a new branch 'fix/chat-wiring-completion'
Your branch is up to date with 'origin/fix/chat-wiring-completion'.
$ git pull origin fix/chat-wiring-completion
Already up to date.
$ git rev-parse HEAD
cb94d04ab8f55b5731b8521f51368c473f977441     ← expected cb94d04a ✓
$ git checkout -b verification/chat-wiring-gap6
$ git tag pre-verify-gap6
$ git push origin verification/chat-wiring-gap6
 * [new branch]        verification/chat-wiring-gap6 -> verification/chat-wiring-gap6
$ git push origin pre-verify-gap6
 * [new tag]           pre-verify-gap6 -> pre-verify-gap6
```

- BASE verified: `fix/chat-wiring-completion @ cb94d04a` ✓
- Tracked tree clean at branch creation ✓

---

## P2 — CODE CHECK (diff 53ee7b81..cb94d04a)

### 2.1 Diff stat

```
$ git diff 53ee7b81..cb94d04a --stat
 scripts/chat-dedup-test.mjs         | 197 ++++++++++++++++++++++++++++++++++++
 server/src/services/Orchestrator.js |  17 +++-
 server/src/services/SimpleTask.js   |  21 ++--
 3 files changed, 225 insertions(+), 10 deletions(-)
```

### 2.2 The fix hunk — Orchestrator.js (executePlan, COMPLEX lane)

```diff
--- a/server/src/services/Orchestrator.js
+++ b/server/src/services/Orchestrator.js
@@ -1705,10 +1705,19 @@
     try {
       // Log the incoming request into memory so long conversations keep context
-      // GAP 6 — DEDUP: same rule as SimpleTask — the handler's rememberTurn()
-      // already persisted this user turn; only a genuinely different
-      // effectiveQuery may log an additional entry.
-      try { const __last = getChatHistory(1)[0]; if (!(__last && __last.role === 'user' && __last.text === String(query))) addChat('user', query); } catch (e) {}
+      // GAP 6 v2 — SINGLE WRITER (Option A): the /api/chat handler is the SOLE
+      // writer of user entries — rememberTurn('user', raw)
+      // (server/index.js:1858) persisted this turn before any lane ran. The
+      // exact-text guard here was structurally leaky: `query` can be a COMPOSED
+      // string (server/index.js:2406-2407 prepends a failed-task context block
+      // + "User's follow-up:" on continue/switch turns) which never equals the
+      // raw text, so the guard let a second user entry through every time the
+      // failed-task path fired (GLM independent verify: 2 user entries per
+      // turn in 2/3 sessions). The composed string STILL drives the graph
+      // below — only the duplicate user-entry write is retired. Invariant:
+      // ONE user entry per user turn, always, regardless of composed text.
+      const GAP6_HANDLER_IS_THE_SOLE_USER_WRITER = true; // handler owns the user-turn record
+      if (!GAP6_HANDLER_IS_THE_SOLE_USER_WRITER) { addChat('user', query); } // retired lane write — never fires (edit, not deletion)
```

### 2.3 The fix hunk — SimpleTask.js (runSimpleTask, SIMPLE lane)

```diff
--- a/server/src/services/SimpleTask.js
+++ b/server/src/services/SimpleTask.js
@@ -13,7 +13,7 @@
-import { addChat, getChatHistory } from './MemoryManager.js';
+import { addChat } from './MemoryManager.js';
@@ -78,11 +78,20 @@
-  // GAP 6 — DEDUP: the chat handler already persisted this user turn via
-  // rememberTurn() before the pipeline ran; logging it again duplicated
-  // every user message in the session store. Suppress only the EXACT
-  // same-text duplicate (a genuinely different effectiveQuery still logs).
-  try { const __last = getChatHistory(1)[0]; if (!(__last && __last.role === 'user' && __last.text === String(query))) addChat('user', query); } catch (e) {}
+  // GAP 6 v2 — SINGLE WRITER (Option A): … (same rationale) …
+  const GAP6_HANDLER_IS_THE_SOLE_USER_WRITER = true; // handler owns the user-turn record
+  if (!GAP6_HANDLER_IS_THE_SOLE_USER_WRITER) { addChat('user', query); } // retired lane write — never fires (edit, not deletion)
```

### 2.4 Writer census after the fix (runtime paths)

```
$ grep -rn "addChat('user'" index.js src/ --include="*.js" | grep -v test
src/services/SimpleTask.js:94:  if (!GAP6_HANDLER_IS_THE_SOLE_USER_WRITER) { addChat('user', query); } // retired lane write — never fires
src/services/Orchestrator.js:1720:  if (!GAP6_HANDLER_IS_THE_SOLE_USER_WRITER) { addChat('user', query); } // retired lane write — never fires
```

Both remaining hits are guarded by a constant `true` → the condition `!GAP6_HANDLER_IS_THE_SOLE_USER_WRITER` is constant-false → **neither lane write can ever fire**.

The sole live writer is the handler's canonical write (`server/index.js:1854-1858`), which runs synchronously at turn start on every entry path (standard :2478, resume :2134, Director :2317):

```js
const raw = String(query || '').trim();
turnUserMessage = raw; // GAP 2 — for the done() hot-memory write
if (raw) {
  rememberTurn('user', raw);
```

**ASSERTION 1 (both lane writers retired): PASS ✓**
**ASSERTION 2 (handler is the sole writer of user entries): PASS ✓**

### 2.5 Composed executionQuery still reaches the LLM

`git diff 53ee7b81..cb94d04a -- index.js` → **0 lines** (server/index.js untouched by the fix). The composition site is intact:

```js
// server/index.js:2406-2407 (UNCHANGED)
if (decision.contextBlock && (decision.metadata.classification === 'continue' || decision.metadata.classification === 'switch')) {
  executionQuery = `${decision.contextBlock}\n\nUser's follow-up: ${effectiveQuery}`;
}
// server/index.js:2478 (UNCHANGED) — the composed string still drives the lanes
const results = await runLegacyPipeline(plan, executionQuery || effectiveQuery);
// server/index.js:2091-2093 (UNCHANGED) — one dispatch, both lanes receive q
const runLegacyPipeline = async (plan, q) => plan.complexity === 'SIMPLE'
  ? await runSimpleTask(plan, q, sendEvent, { image, convId })
  : await orchestrator.executePlan(plan, q, sendEvent, { … });
```

**ASSERTION 3 (composed string untouched for the LLM): PASS ✓**

---

## P3 — PROBE RUN #1 RAW (independent probe, 5 sessions × 4 turns)

Probe: boots an ISOLATED server (own PORT 3949, own DATA_DIR outside the repo — store starts empty, counts exact). Per session: t1/t2 new build requests (create tasks; keyless runs end `success:false` → registry marks them failed/completed), **t3 = "back to the <turn-1 task wording>" → SWITCH onto the finished task → ConversationManager attaches `taskContextBlock` → DecisionEngine returns classification `switch` + `contextBlock` → index.js:2406-2407 composes `<block>\n\nUser's follow-up: <raw>` — THE failed-task path**; t4 = standalone math question ('new', no task). After EVERY turn: on-disk store diff — must be EXACTLY 1 new user entry with text === raw. Whole-store scan: no user entry may contain the composed prefix `"User's follow-up:"`. Turn 3 must report intel `classification=switch` (path-proven; no pass-by-default).

```
== GLM GAP 6 RE-VERIFY PROBE — RUN1 — 5 sessions x 4 turns ==
[boot] isolated server :3949 up in 1.8s (DATA_DIR=/home/z/my-project/scripts/gap6-verify-store-run1-1790402539786)
  [s1·t1] new build                              intel=new     new_user_entries=1 text===raw:Y turn_ok=true (12.5s) -> PASS
  [s1·t2] new build #2                           intel=new     new_user_entries=1 text===raw:Y turn_ok=true (10.6s) -> PASS
  [s1·t3] FAILED-TASK (switch->contextBlock prepend) intel=switch  new_user_entries=1 text===raw:Y turn_ok=false (2.4s) -> PASS
  [s1·t4] standalone question                    intel=new     new_user_entries=1 text===raw:Y turn_ok=false (4.7s) -> PASS
  [s2·t1] new build                              intel=switch  new_user_entries=1 text===raw:Y turn_ok=true (24.7s) -> PASS
  [s2·t2] new build #2                           intel=switch  new_user_entries=1 text===raw:Y turn_ok=true (9.4s) -> PASS
  [s2·t3] FAILED-TASK (switch->contextBlock prepend) intel=switch  new_user_entries=1 text===raw:Y turn_ok=false (2.2s) -> PASS
  [s2·t4] standalone question                    intel=switch  new_user_entries=1 text===raw:Y turn_ok=false (4.6s) -> PASS
  [s3·t1] new build                              intel=switch  new_user_entries=1 text===raw:Y turn_ok=true (10.6s) -> PASS
  [s3·t2] new build #2                           intel=switch  new_user_entries=1 text===raw:Y turn_ok=true (25.8s) -> PASS
  [s3·t3] FAILED-TASK (switch->contextBlock prepend) intel=switch  new_user_entries=1 text===raw:Y turn_ok=false (2.2s) -> PASS
  [s3·t4] standalone question                    intel=switch  new_user_entries=1 text===raw:Y turn_ok=false (4.6s) -> PASS
  [s4·t1] new build                              intel=switch  new_user_entries=1 text===raw:Y turn_ok=true (10.5s) -> PASS
  [s4·t2] new build #2                           intel=switch  new_user_entries=1 text===raw:Y turn_ok=true (9.6s) -> PASS
  [s4·t3] FAILED-TASK (switch->contextBlock prepend) intel=switch  new_user_entries=1 text===raw:Y turn_ok=true (5.8s) -> PASS
  [s4·t4] standalone question                    intel=switch  new_user_entries=1 text===raw:Y turn_ok=false (4.6s) -> PASS
  [s5·t1] new build                              intel=switch  new_user_entries=1 text===raw:Y turn_ok=true (15.6s) -> PASS
  [s5·t2] new build #2                           intel=switch  new_user_entries=1 text===raw:Y turn_ok=true (9.3s) -> PASS
  [s5·t3] FAILED-TASK (switch->contextBlock prepend) intel=switch  new_user_entries=1 text===raw:Y turn_ok=false (2.1s) -> PASS
  [s5·t4] standalone question                    intel=switch  new_user_entries=1 text===raw:Y turn_ok=false (4.6s) -> PASS

== PER-SESSION USER-ENTRY COUNTS ==
| session | t1 | t2 | t3 (failed-task) | t4 | total user entries | verdict |
|---------|----|----|------------------|----|--------------------|---------|
| s1 | 1 | 1 | 1 | 1 | 4 | PASS |
| s2 | 1 | 1 | 1 | 1 | 4 | PASS |
| s3 | 1 | 1 | 1 | 1 | 4 | PASS |
| s4 | 1 | 1 | 1 | 1 | 4 | PASS |
| s5 | 1 | 1 | 1 | 1 | 4 | PASS |

composed-prefix leak ("User's follow-up:" in any user entry): 0
failed-task path proofs (turn-3 intel=switch): 5/5

== VERDICT (RUN1) ==
  turn rows PASS: 20/20
  composed-prefix leak: 0 (must be 0)
  failed-task path fired: 5/5 sessions (must be 5)
  session-1 store dump: CLEAN

RESULT: 20/20 PASS — GAP 6 SINGLE-WRITER INVARIANT HOLDS (RUN1)
```

Note: sessions 2–5 turn 1/2/4 also classified `switch` (the global task registry carries earlier sessions' tasks, so the classifier attached a context block on those turns too) — this only WIDENS composed-path coverage: every such turn still logged exactly one raw-text user entry.

---

## P4 — PROBE RUN #2 RAW (independent run: fresh stamp, fresh DATA_DIR, fresh server)

```
== GLM GAP 6 RE-VERIFY PROBE — RUN2 — 5 sessions x 4 turns ==
[boot] isolated server :3949 up in 1.8s (DATA_DIR=/home/z/my-project/scripts/gap6-verify-store-run2-1790402765386)
  [s1·t1] new build                              intel=new     new_user_entries=1 text===raw:Y turn_ok=true (12.3s) -> PASS
  [s1·t2] new build #2                           intel=new     new_user_entries=1 text===raw:Y turn_ok=true (10.5s) -> PASS
  [s1·t3] FAILED-TASK (switch->contextBlock prepend) intel=switch  new_user_entries=1 text===raw:Y turn_ok=false (2.2s) -> PASS
  [s1·t4] standalone question                    intel=new     new_user_entries=1 text===raw:Y turn_ok=false (4.6s) -> PASS
  [s2·t1] new build                              intel=switch  new_user_entries=1 text===raw:Y turn_ok=true (25.3s) -> PASS
  [s2·t2] new build #2                           intel=switch  new_user_entries=1 text===raw:Y turn_ok=true (9.3s) -> PASS
  [s2·t3] FAILED-TASK (switch->contextBlock prepend) intel=switch  new_user_entries=1 text===raw:Y turn_ok=false (2.2s) -> PASS
  [s2·t4] standalone question                    intel=switch  new_user_entries=1 text===raw:Y turn_ok=false (4.6s) -> PASS
  [s3·t1] new build                              intel=switch  new_user_entries=1 text===raw:Y turn_ok=true (10.5s) -> PASS
  [s3·t2] new build #2                           intel=switch  new_user_entries=1 text===raw:Y turn_ok=true (23.2s) -> PASS
  [s3·t3] FAILED-TASK (switch->contextBlock prepend) intel=switch  new_user_entries=1 text===raw:Y turn_ok=false (2.2s) -> PASS
  [s3·t4] standalone question                    intel=switch  new_user_entries=1 text===raw:Y turn_ok=false (4.6s) -> PASS
  [s4·t1] new build                              intel=switch  new_user_entries=1 text===raw:Y turn_ok=true (10.6s) -> PASS
  [s4·t2] new build #2                           intel=switch  new_user_entries=1 text===raw:Y turn_ok=true (9.4s) -> PASS
  [s4·t3] FAILED-TASK (switch->contextBlock prepend) intel=switch  new_user_entries=1 text===raw:Y turn_ok=true (5.8s) -> PASS
  [s4·t4] standalone question                    intel=switch  new_user_entries=1 text===raw:Y turn_ok=false (4.6s) -> PASS
  [s5·t1] new build                              intel=switch  new_user_entries=1 text===raw:Y turn_ok=true (18.3s) -> PASS
  [s5·t2] new build #2                           intel=switch  new_user_entries=1 text===raw:Y turn_ok=true (9.4s) -> PASS
  [s5·t3] FAILED-TASK (switch->contextBlock prepend) intel=switch  new_user_entries=1 text===raw:Y turn_ok=false (2.2s) -> PASS
  [s5·t4] standalone question                    intel=switch  new_user_entries=1 text===raw:Y turn_ok=false (4.8s) -> PASS

== PER-SESSION USER-ENTRY COUNTS ==
| session | t1 | t2 | t3 (failed-task) | t4 | total user entries | verdict |
|---------|----|----|------------------|----|--------------------|---------|
| s1 | 1 | 1 | 1 | 1 | 4 | PASS |
| s2 | 1 | 1 | 1 | 1 | 4 | PASS |
| s3 | 1 | 1 | 1 | 1 | 4 | PASS |
| s4 | 1 | 1 | 1 | 1 | 4 | PASS |
| s5 | 1 | 1 | 1 | 1 | 4 | PASS |

composed-prefix leak ("User's follow-up:" in any user entry): 0
failed-task path proofs (turn-3 intel=switch): 5/5

== VERDICT (RUN2) ==
  turn rows PASS: 20/20
  composed-prefix leak: 0 (must be 0)
  failed-task path fired: 5/5 sessions (must be 5)
  session-1 store dump: CLEAN

RESULT: 20/20 PASS — GAP 6 SINGLE-WRITER INVARIANT HOLDS (RUN2)
```

**Both runs 20/20 → deterministic. ✓**

---

## P5 — STORE DUMP (session 1, full, every entry — RUN1; RUN2 structurally identical)

```
== STORE DUMP — SESSION 1 (full, every entry) ==
  role=user  text="build me a pomodoro timer web app gap6v-1790402539786-s1"
  role=jexi  text="### 💻 Build did not complete\n\nI tried twice (including rewriting the brief myself) but could not produce a working build this time. This is usually a"
  role=user  text="build me a small notes web app gap6v-1790402539786-s1-b"
  role=jexi  text="### 💻 Build did not complete\n\nI tried twice (including rewriting the brief myself) but could not produce a working build this time. This is usually a"
  role=user  text="back to the pomodoro timer web app gap6v-1790402539786-s1"
  role=jexi  text="### ⚠ JEXI OS\n\nI hit a problem while working on this: No AI provider answered (tried the keyless Pollinations leg too). Configure ONE model in Setting"
  role=user  text="what is 17 plus 25 exactly?"
  role=jexi  text="### ⚠ JEXI OS — degraded mode\n\nI'm having trouble reaching my usual AI resources right now (pollinations: All AI providers failed for tool calling. no"
  (session-1: 8 entries total, 4 user entries across 4 turns)
  dump assertion (4 user entries, none composed): CLEAN
```

Assertions on the dump:
- **user/jexi alternation**: strict `user → jexi → user → jexi → …`, 4 user + 4 jexi entries for 4 turns ✓
- **no duplicates**: each user text appears exactly once; turn 3's entry is the RAW text — no `"User's follow-up:"` composed duplicate (this exact turn double-logged before the fix) ✓
- **no composed prefix**: whole-store scan found 0 user entries containing `"User's follow-up:"` in both runs ✓

---

## P6 — REGRESSION SPOT-CHECK RAW

```
$ node server/test-chat-continuity.js
  ✅ C1: "my name is Zephyr" lifted into durable profile/user facts
  ✅ C1: session store hit the disk (DATA_DIR/sessions/156bfc78e5932c3a260ae46b.json)
  ✅ C1: conversationContext("what is my name?") CARRIES turn 1 ("Zephyr") into turn 2's prompt
  ✅ C1: turn 1 rides as the verbatim User turn (history block)
  ✅ C1: profile fact + history both name Zephyr
  ✅ C1: even with convId=null the session history still flows (activeSession module scope)
  ✅ C2: the assembled worker prompt carries the continuity block
== RESULT: 9 passed, 0 failed ==

$ node server/test-chat-memory-intent.js
  ✅ GAP4/T-c: a build request is NOT captured (intent=code_task)
  ✅ GAP4/T-d: SIMPLE_INTENTS contains memory_query, recall, what_did_i_say, remember_when
  ✅ GAP4/T-d: memory intents assign the memory coworker (the one with brain recall)
== RESULT: 14 passed, 0 failed ==

$ node server/test-chat-wiring-fix.js
  ✅ runWorker end-to-end: tool lane completes OK (deterministic seam, zero network)
  ✅ general chat still routes to the memory coworker (now groq-capable)
== RESULT: 22 passed, 0 failed ==
```

**No regressions: 9/9 + 14/14 + 22/22. ✓**

---

## P7 — VERDICT

**GAP 6 = PASS**

| PASS requirement | Evidence | Result |
|---|---|---|
| Code check confirms single-writer | P2: both lane writes constant-guarded, never fire; handler `rememberTurn` sole writer; composed string still reaches the LLM (index.js untouched) | ✓ |
| 2× independent runs both 20/20 | P3 (RUN1 20/20) + P4 (RUN2 20/20), fresh store each run | ✓ |
| Store dump clean | P5: strict user/jexi alternation, no duplicates, no composed prefix | ✓ |
| No regression in spot-check | P6: 9/9 + 14/14 + 22/22 | ✓ |

The single-writer invariant — **ONE user entry per user turn, always, regardless of composed text** — is now structural: the only runtime writer of user entries is the chat handler, so no lane, no composed query, and no future composed variant can double-log. The prior non-deterministic failure mode (2 entries in 2/3 sessions) is eliminated at the source, not deduped after the fact.

Findings (non-blocking, for the record):
1. The retired lane writes remain in the code as constant-guarded no-ops (`GAP6_HANDLER_IS_THE_SOLE_USER_WRITER`). Deliberate: honors the "no deletions, edits only" rule; documented in place. A future cleanup commit may remove them outright.
2. The ConversationManager's loose title matching cross-references tasks from OTHER sessions on the shared global registry (sessions 2–5 turn 1 classified `switch`). Out of GAP 6 scope — it does not affect entry counts — but worth its own ticket if cross-session task isolation ever matters.
3. `keyless` runs end many turns `success:false` (no provider). Irrelevant to this verify: user entries are written pre-LLM, which is exactly why the count evidence is deterministic.

## P8 — docs/VERIFY-CHAT-WIRING-GAP6.md rendered

This document IS the rendered report (committed as the sole artifact of the verification branch).

## P9 — ZERO-TOUCH PROOF

- Verification performed on branch `verification/chat-wiring-gap6` @ `cb94d04a` (read-only checkout of the fix).
- NO repo file was edited, merged, rebased, or deleted during verification: the probe script lives OUTSIDE the repo (`/home/z/my-project/scripts/verify-gap6-probe.mjs`); probe servers ran with isolated `PORT` + `DATA_DIR` (outside the repo), leaving `server/data/` untouched.
- `git status` before the commit shows ONLY the new report file: `?? docs/VERIFY-CHAT-WIRING-GAP6.md`. The commit adds exactly one file.

## P10 — ZONE CHECK

- ZONE declared: `docs/VERIFY-CHAT-WIRING-GAP6.md` ONLY.
- Committed: `docs/VERIFY-CHAT-WIRING-GAP6.md` — exactly one file, matching the ZONE. ✓
- No merge to main. No force-push. No rebase. One commit. ✓
