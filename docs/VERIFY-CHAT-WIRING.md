# VERIFY-CHAT-WIRING — Independent Verification Report

- **Verifier**: GLM (independent — builder was Arena; builder ≠ verifier)
- **Date**: 2026-09-25
- **Base**: `fix/chat-wiring-completion` @ `53ee7b813feec8b27a76b08c0511388ee114f2a9` (`53ee7b81`)
- **Branch**: `verification/chat-wiring` (new, off `53ee7b81`) · tag `pre-verify-chat-wiring`
- **Method**: all six gaps re-probed with freshly written verifier probes (regenerated — zero reuse of builder test files). Probes live **outside** the repo at `scripts/verify-chat/` (my-project scratch), so the repo sees only this report. E2E harness run as-built (Arena's `scripts/chat-e2e-audit.mjs`, per the task spec).

## OVERALL VERDICT: **FAIL** (G6 fails the lead's acceptance criterion; G1–G5 PASS)

| Gap | Verdict | One-line evidence |
|-----|---------|-------------------|
| G1 BrainRecall 4 sources | **PASS** | 18/18 — all four real boot-built sources render in one block; budgets {400,500,300,300}=1500 enforced; two sabotaged sources fail-soft |
| G2 brain.hot write-back | **PASS** | 9/9 — S1 turn lands in hot store; brand-new S2's prompt contains the fact, tagged with origin session; handler done() call-site asserted |
| G3 COMPLEX coordinator recall | **PASS** | 14/14 — first node gets query+block, second node byte-identical original (shared run state); narration exactly once; executePlan + convId wiring asserted |
| G4 SIMPLE_INTENTS | **PASS** | spec probes pass: "what is my name?" → memory_query+SIMPLE; "write me a poem" → NOT memory_query; 1 out-of-contract phrasing finding (P4-F2) |
| G5 session header (server half) | **PASS** | raw log lines: `session=verify-g5-header-777 source=x-jexi-session header` and `session=127.0.0.1 source=fallback(ip)` |
| G6 double-log fix | **FAIL** | exactly-ONE-user-entry-per-turn violated non-deterministically: 2 of 3 fresh sessions doubled (both turns) — composed `executionQuery` rides past the exact-text dedup guard |

---

## P1 — Step 0 refs + base SHA

```
git fetch origin
git checkout fix/chat-wiring-completion   # (branch lives in worktree jexi-29; pulled there with --ff-only)
git pull origin fix/chat-wiring-completion # "Already up to date"
git rev-parse HEAD
  → 53ee7b813feec8b27a76b08c0511388ee114f2a9   (expected 53ee7b81 ✓)
git checkout -b verification/chat-wiring   # off 53ee7b81 (full SHA pinned)
git tag pre-verify-chat-wiring
git push origin verification/chat-wiring    # * [new branch]
git push origin pre-verify-chat-wiring      # * [new tag]
```

`git ls-remote origin` after push (all three must be `53ee7b81…`):

```
53ee7b813feec8b27a76b08c0511388ee114f2a9  refs/heads/fix/chat-wiring-completion
53ee7b813feec8b27a76b08c0511388ee114f2a9  refs/heads/verification/chat-wiring
53ee7b813feec8b27a76b08c0511388ee114f2a9  refs/tags/pre-verify-chat-wiring
```

- `origin/main` = `bd4787cde8562bf0fee0d1515812cdd16170fa07` (`bd4787cd` — matches the lead's expectation from the prior task; untouched by this work).
- Local HEAD of `verification/chat-wiring` after the report commit is one commit **ahead** of `53ee7b81` (the report only — see P7).

---

## P2 — Per-gap probes + raw output + verdict

Probe files (all written fresh for this verification, stored outside the repo):

```
scripts/verify-chat/probe-g1-brain-recall.mjs
scripts/verify-chat/probe-g2-hot-writeback.mjs
scripts/verify-chat/probe-g3-coordinator.mjs
scripts/verify-chat/probe-g4-intents.mjs
scripts/verify-chat/probe-g5-g6-server.sh      (boots the real server, curls /api/chat)
scripts/verify-chat/probe-g6b-determinism.sh   (3 fresh sessions × 2 turns)
```

Environment per probe: fresh `mkdtemp` `DATA_DIR` / `JEXI_HOME` / `JEXI_W31_RUNTIME`; provider keys unset; deterministic, zero network for G1–G4.

### G1 — BrainRecall feeds 4 sources — **PASS** (18/18)

Static read (`server/src/services/BrainRecall.js`): `BRAIN_BUDGETS = { hot: 400, hybrid: 500, semantica: 300, instincts: 300 }`, `BRAIN_TOTAL_BUDGET = 1500`; each source wrapped in its own try/catch (fail-soft by construction).

Probe seeding through the **real boot-built wiring** (no mocks):
- hot → `wiring.hot.record({fact:'Verifier marker G1: the hot fact names Zanzibar', kind:'fact', sourceId:'chat', sessionId:'g1-sess', opSeq:1})`
- hybrid → `wiring.repo.create('concepts','verify-g1-harbor',{title:'Harbor Bridge Manual', compiledTruth:'The harbor bridge opens on Tuesday mornings.',…})` + `wiring.index.rebuild()`
- semantica → `wiring.graph.addNode({id:'g1-cat-delta', kind:'entity', label:'Verifier cat is named Delta'})`
- instincts → `recordCandidate(globalStorePath(), {type:'workarounds', pattern:'g1 verify instinct: archive the probe manifest before reboot',…}, {scope:'global'})`

Raw assembled block (one call, `query='harbor bridge cat delta archive probe manifest reboot'`) — all four sections present:

```
Relevant JEXI brain memory (use silently — never mention that you recalled it):
Hot memory (latest facts):
- [hot:g1-sess] fact: Verifier marker G1: the hot fact names Zanzibar
Relevant brain pages (hybrid retrieval):
- [brain] concepts/verify-g1-harbor · … (score 0.461)
Ontology (semantica graph):
- [graph] entity: Verifier cat is named Delta
INSTINCTS:
- [global|workarounds] g1 verify instinct: archive the probe manifest before reboot
```

Fail-soft proof (sabotage two sources to throw, other sections survive, call never rejects):

```
PASS A3 sabotaged sources: call never rejects (string returned)
PASS A3 hot survives the failure of hybrid+graph
PASS A3 instincts survive the failure of hybrid+graph
PASS A3 broken sources are skipped, not half-rendered
```

Budget clip proof (4 matching ~110-char graph nodes force the 300 budget):

```
PASS A4 oversized-seed block within 1500 total (got 550)
PASS A4 graph section actually rendered for the overflow query (non-vacuous)
PASS A4 semantica LINES clipped to <= 300 chars (got 299)
raw: semantica lines post-clip = 299 chars, block total = 550
```

Note: budget constants could also be read as source code, so the probe asserted them via the exported `BRAIN_BUDGETS`/`BRAIN_TOTAL_BUDGET` **and** enforced them behaviorally (clip observed at runtime). Verifier transparency: my first A4 attempt was vacuous (3-char query vs the ≥4-char gate) — fixed and re-run before verdict.

### G2 — brain.hot write-back — **PASS** (9/9)

Lead's acceptance test executed:

```
TURN1 brainHotWriteTurn returns true for a real exchange        (S1-verify: "my verification albatross is named Emperor")
--- S2 prompt block (raw) ---
Relevant JEXI brain memory (use silently — never mention that you recalled it):
Hot memory (latest facts):
- [hot:S1-verify] event: User: my verification albatross is named Emperor — JEXI: Recorded — Emperor.
PASS TURN2 new-session prompt contains fact F ("Emperor")
PASS TURN2 fact arrives via the hot section ([hot …])
PASS TURN2 hot line is tagged with the ORIGIN session id (cross-session provenance)
PASS store-level: hot.recall(sourceId=chat) carries the turn fact (1 chat facts)
```

Handler wiring (source assertion, `server/index.js` done()):

```
PASS handler source: done() calls brainHotWriteTurn({sessionId: convId, userMessage: turnUserMessage, assistantAnswer: payload.summary})
PASS handler source: write gated on successful turn + non-empty raw query
```

RAW observation for P4: issuing the **identical** write twice left exactly **1** visible fact (`Emperor fact rows in hot store = 1`) even though `factId()` hashes `opSeq` (which increments per call) — recall-level dedup/supersession collapses the retry. Beneficial; recorded as evidence, not a defect.

### G3 — COMPLEX coordinator recall — **PASS** (14/14)

Real `orchestrator.wrapCase` nodes over capture bodies, **one shared run state** (as in a real graph run). Seeded fact via the real write path: `"our verify codename is Indigo Falcon"`.

```
--- coordinator prompt (raw, first 8 lines) ---
  | plan the codename release
  |
  | Relevant JEXI brain memory (use silently — never mention that you recalled it):
  | Hot memory (latest facts):
  | - [hot:g3-sess] event: User: our verify codename is Indigo Falcon — JEXI: Recorded — Indigo Falcon.
PASS A1 first node receives the original query as its base
PASS A2 coordinator prompt CONTAINS the brain block (seeded fact present)
PASS A1 second node sees the ORIGINAL query byte-for-byte (block never reaches sub-agents)
PASS A1 the two prompts differ (feed really happened once)
PASS A3 coordinator narration fired exactly once per run (got 1)
PASS A3 narration names the lead node
PASS A4 empty brainContext -> prompt unchanged (fail-soft)
PASS A5 executePlan computes state.brainContext from the SAME bridge with opts.convId
PASS A5 index.js graph dispatch passes convId into executePlan opts
```

Wiring locations asserted from source: `Orchestrator.js` (`state.brainContext = await brainRecallBlock({ sessionId: opts?.convId || null, query })` in `executePlan`) and `index.js` (graph dispatch passes `convId`). The one-shot scope is `state.context.coordinatorFed` — per graph **run**, not per node; verified by running lead+second nodes on the same state. (My first probe run modeled this wrong — two fresh states — produced 3 spurious failures; corrected to shared state and re-run. The product behavior was correct in both runs.)

### G4 — SIMPLE_INTENTS — **PASS** (spec probes; 12/13 with 1 over-strict extra)

```
raw: "what is my name?" -> intent=memory_query complexity=SIMPLE
PASS A1 "what is my name?" -> memory_query
PASS A1 memory_query routes SIMPLE (no graph)
raw: "what did i say about the harbor bridge?" -> memory_query SIMPLE
PASS A2 "what did i say about …" -> memory_query
raw: "remember when we launched the project?" -> memory_query SIMPLE
PASS A2 "remember when …" -> memory_query
raw: "do you remember my birthday?" -> memory_query SIMPLE
PASS A2 "do you remember …" -> memory_query
raw: "which of these is my favorite city?" -> intent=learning_research complexity=COMPLEX
FAIL A2 "which … is my …" -> memory_query          ← over-strict extra (see P4-F2)
raw: "write me a poem" -> intent=learning_research complexity=COMPLEX
PASS A3 "write me a poem" -> NOT memory_query
PASS A4 SIMPLE_INTENTS has "memory_query" / "recall" / "what_did_i_say" / "remember_when"
PASS A5 CLASSIFIER_INTENTS source contains recall, what_did_i_say, remember_when
```

The lead's two required probes both pass. `Planner.js:145` SIMPLE_INTENTS and `Planner.js:149-151` CLASSIFIER_INTENTS carry the added slugs; the deterministic fast path (`Planner.js:393-404`) fires **before** any LLM call, so the route holds keyless.

### G5 — session header (server half) — **PASS**

Real server booted (isolated stores, port 3997, keys unset). Two curls to `POST /api/chat`:

```
== G5a: WITH x-jexi-session: verify-g5-header-777 ==
server log line:
[chat] session=verify-g5-header-777 source=x-jexi-session header

== G5b: WITHOUT header ==
server log line:
[chat] session=127.0.0.1 source=fallback(ip)
```

Both required observability lines appear exactly as specified (`index.js:1718-1724`, `conversationId()` header-first). Verdict **PASS**. (Frontend half of GAP 5 lives on `ui/rebuild-premium-v2`, unmerged — outside this branch; see P5.)

### G6 — double-log fix — **FAIL**

Acceptance: *send one turn → exactly ONE user-message entry per turn in the session store.* Executed twice, independently:

**Run 1** (session `verify-g6-single-42`, two turns; server log confirms 2 turns on the session):

```
raw history dump:
  role=user text="what is my name?"
  role=user text="Current task: TASK-001 — what is my name? (failed)\nObjective: what is my name? (…"   ← EXTRA
  role=jexi text="### ⚠ JEXI OS — degraded mode …"
  role=user text="what did i say about the harbor bridge?"
  role=jexi text="### ⚠ JEXI OS — degraded mode …"
COUNTS: user_entries_total=3 turn1_text=2 turn2_text=1
G6 VERDICT: FAIL
```

Full extra entry (uncut) proves it is a **composed executionQuery**, not the raw message:

```
Current task: TASK-001 — what is my name? (failed)
Objective: what is my name? (about: what is my name?)
Completed: Memory Agent → Archivist → Context Manager
Remaining: Memory Agent → Archivist → Context Manager

User's follow-up: what is my name? (about: what is my name?)
```

**Run 2** — determinism sweep (3 fresh sessions × 2 turns):

```
### verify-g6b-s1: user_entries=2 …  (1 per turn — clean)
### verify-g6b-s2: user_entries=4 …  (BOTH turns doubled: TASK-001 + TASK-002 composed blocks)
### verify-g6b-s3: user_entries=4 …  (BOTH turns doubled)
```

Mechanism (attributed from source + evidence):

1. GAP 6's dedup guard (`SimpleTask.js:85`, `Orchestrator.js:1711`) suppresses only a **byte-identical** duplicate — its comment declares a genuinely different `effectiveQuery` SHOULD log.
2. `index.js:2406-2407` rewrites `executionQuery = ${decision.contextBlock}\n\nUser's follow-up: ${effectiveQuery}` whenever a continue/switch decision carries a task context block.
3. `index.js:2478` dispatches `runLegacyPipeline(plan, executionQuery || effectiveQuery)` → the lane logs the composed text as a second `role:'user'` entry.
4. Trigger is **non-deterministic** and **cross-session**: the TaskRegistry is not session-scoped, so a failed task left by an earlier turn (or another session — s1's failed TASK-001 caused s2's turn A to double) flips the decision into continue/retry with a context block. s1 (fresh registry) was clean; s2/s3 doubled.

Fairness note: the GAP 6 commit's declared scope (kill the exact-duplicate double-log in both lanes) **works** — the raw text appears exactly once everywhere, and Arena's e2e T9 single sample passed. But the lead's acceptance ("exactly ONE user-message entry per turn") is violated by the composed-query path, so G6 = **FAIL**. The doubling reproduced only on failed turns (keyless); behavior under live keys is NOT VERIFIED (P5).

---

## P3 — E2E raw table (Arena's `scripts/chat-e2e-audit.mjs`, run as-built, keyless)

```
keys: GROQ_API_KEY=unset (keyless runs ride the pollinations fail-soft floor)
[boot] no server on :3002 — spawning one…
[boot] server up in 2.1s

== PASS/FAIL TABLE ==
| id | test | result | detail |
|----|------|--------|--------|
| T1 | 5 consecutive SIMPLE turns succeed | FAIL | #1:FAIL(pollinations(failed),6.9s) #2:FAIL(pollinations(failed),7.0s) #3:FAIL(pollinations(failed),6.9s) #4:FAIL(pollinations(fail…
| T1b | provider per turn (groq expected on a keyed host) | PASS | pollinations(failed),pollinations(failed),pollinations(failed),pollinations(failed),pollinations(failed) |
| T2 | turn 2 answer contains "Lewis" | FAIL | t1:ok t2:FAIL answer: ### ⚠ JEXI OS — degraded mode  I'm having trouble reaching my usual AI resources right now |
| T7 | GAP 4: "what is my name?" routed SIMPLE, single coworker (no 3-agent graph) | PASS | simple=true graphAvoided=true |
| T3 | GAP 2: NEW session recalls "Rusty" from hot memory | FAIL | teach:ok ask:FAIL answer: ### ⚠ JEXI OS — degraded mode … |
| T4 | GAP 1: semantica fact seeded → present in the assembled prompt | PASS | == RESULT: 12 passed, 0 failed == |
| T5 | GAP 1: instinct seeded → present in the assembled prompt | PASS | same suite, T-b assertions |
| T6a | GAP 3: coordinator one-shot feed (deterministic suite) | PASS | == RESULT: 5 passed, 0 failed == |
| T6b | GAP 3: live COMPLEX turn narrates coordinator brain context | FAIL | brain block was empty (needs earlier successful turns / non-empty brain) — unit leg T6a is the hard proof |
| T8 | GAP 5: x-jexi-session header honored (conversationId echoes the header) | PASS | session=e2e-t8-1790340218237 |
| T9 | GAP 6: exactly ONE user entry per turn in the session store | PASS | user entries for the turn text: 1; store: [{"role":"jexi","text":"### 🔎 JEXI OS — RESEARCH RESULTS… |

== RESULT: 7/11 PASS — 4 failure(s) ==
```

Row classification:

| Row | Class | Keyless verdict |
|-----|-------|-----------------|
| T1, T2, T3, T6b | **LLM-dependent** (need live provider answers; T6b cascades from successful turns) | NOT VERIFIED-keyless (pollinations floor exhausted) |
| T1b, T4, T5, T6a, T7, T8, T9 | **Deterministic** | PASS (7/7) |

Note on T1b: PASS here asserts *honesty* (no false provider claim while keyless) — not provider success. Note on T9: it is a single-sample deterministic row; my independent 3-session sweep (P2-G6) found doubling in 2/3 sessions, so T9's PASS is a lucky sample of a non-deterministic behavior — the G6 FAIL verdict stands on the sweep, not on this row.

---

## P4 — Findings

- **F1 (defect, causes G6 FAIL)** — Composed-`executionQuery` second user entry. `index.js:2406-2407` builds `${contextBlock}\n\nUser's follow-up: …` for continue/switch decisions; `index.js:2478` dispatches it; both lanes' dedup guards (`SimpleTask.js:85`, `Orchestrator.js:1711`) intentionally pass different-text queries → second `role:'user'` entry. Non-deterministic (2/3 sessions in sweep; 1 of 2 turns in run 1) and cross-session (global TaskRegistry not session-scoped — s1's failed task contaminated s2). Suggested direction (NOT applied — read-only): guard should compare against the *turn-raw* text (`raw`), or the lane should not re-log user turns at all since the handler's `rememberTurn` owns that entry; also consider scoping the decision layer's failed-task retry to the current session.
- **F2 (edge miss, non-blocking)** — `"which of these is my favorite city?"` → `learning_research`/COMPLEX keyless. The GAP 4 fast-path regex requires `(what|who|which)` immediately followed by `is|are|was|were my`; split phrasing ("which of these is my…") slips past into the keyless classifier fallback. Outside the declared GAP 4 contract (both required probes pass), but a plausible real-user phrasing worth a follow-up regex.
- **F3 (positive observation)** — identical retry writes into `brain.hot` surface exactly one fact via recall despite `opSeq`-salted ids (content-visible dedup downstream). Keeps cross-session recall clean under retries.
- **F4 (e2e wording)** — T1b's label ("provider per turn, groq expected") reads like a provider-success row but asserts no-false-claim honesty; harmless, worth a label tweak to avoid misreading on a keyed host.
- **F5 (verifier transparency)** — two of my probe iterations were initially wrong, not the product: G1-A4 was vacuous (3-char query vs ≥4-char gate) and G3 first modeled the one-shot feed per-state instead of per-run. Both were corrected and re-run; final verdicts rest only on the corrected runs.

## P5 — NOT VERIFIED list

1. **All LLM-answer behavior with live keys**: T1 streak, T2 continuity answer, T3 cross-session recall answer, T6b live narration — sandbox is keyless and the pollinations floor was exhausted (0/4 model calls succeeded per meter). The lead must run `scripts/chat-e2e-audit.mjs` with `GROQ_API_KEY`.
2. **G2 over live HTTP** (teach on S1 → new session S2 answer contains the fact with a real model): deterministic in-process proof + handler source assertion only; SSE output does not expose the assembled prompt.
3. **G6 under live keys**: the doubling reproduced only on *failed* turns (task fails → retry/continue classification on a later pass). With succeeding turns the trigger may not fire; the keyless FAIL stands, live behavior unproven.
4. **GAP 5 frontend half** (`x-jexi-session` sender in `backendAgent.js` / `chat/sessions.js`): exists only on `ui/rebuild-premium-v2` (unmerged) — not present on this branch, out of ZONE. Matches the builder's own disclosure.
5. **Hybrid retrieval embedding quality**: index backend is `rule-based` (boot log: "embedding model NOT VERIFIED") — scored recall works (probe proved page retrieval) but semantic quality is unmeasured.
6. **Dream cycle** and other non-chat brain subsystems: out of scope for this verification (chat wiring only).

## P6 — Report rendering

This document (`docs/VERIFY-CHAT-WIRING.md`) is the deliverable rendered in full above — P1–P8 complete in one file, committed alone.

## P7 — Zero-touch proof

- **Working tree clean after every probe run**: `git status --short` → empty (verified repeatedly; final check below).
- The e2e harness overwrote tracked `docs/CHAT-WIRING-COMPLETION-AUDIT.md` during its run; it was restored immediately (`git checkout --`); blob identity proven: `git rev-parse HEAD:docs/CHAT-WIRING-COMPLETION-AUDIT.md` == `7b398437efc1746c990a95b4492b4815394c10b8` before **and** after the run (snapshot taken pre-run, restore verified post-run).
- **No builder test file reused or modified**: `test-chat-brain-feed.js`, `test-chat-coordinator.js`, `test-chat-memory-intent.js`, `test-chat-continuity.js`, `test-chat-wiring-fix.js`, `test-worker-router.js`, `scripts/chat-*.mjs` — read for API recon only; all six verifier probes were written from scratch (file list in P2) and live **outside** the repo.
- `server/node_modules` was staged into this worktree by copying from the sibling worktree (`jexi-29`) — gitignored path, zero tracked-file impact.
- **One commit** on this branch: the report file only (`docs/VERIFY-CHAT-WIRING.md`).
- No merges, no deletions, no edits to `server/`, `interfaces/`, or any tracked file.

## P8 — Zone check

- ZONE = `docs/VERIFY-CHAT-WIRING.md` ONLY → **held**: exactly one file added, exactly one commit (`verify: chat wiring completion — FAIL`), pushed to `verification/chat-wiring`.
- Probes + raw evidence artifacts live outside the repo (`/home/z/my-project/scripts/verify-chat/`): `probe-g1-brain-recall.mjs`, `probe-g2-hot-writeback.mjs`, `probe-g3-coordinator.mjs`, `probe-g4-intents.mjs`, `probe-g5-g6-server.sh`, `probe-g6b-determinism.sh`, `g5a/g5b/g6b-*` raw curl outputs, `g56-server.log`, `e2e-results-copy.md`.
- Verification is READ-ONLY over the builder's code: no fixes applied (P4 findings reported with line refs for the lead instead).
- Refs after push (verified via `git ls-remote`): `verification/chat-wiring` = one commit ahead of base (report only) · tag `pre-verify-chat-wiring` = `53ee7b81` · base `fix/chat-wiring-completion` untouched at `53ee7b81` · `main` untouched at `bd4787cd`.

**STOP** — verification complete; no further action taken.
