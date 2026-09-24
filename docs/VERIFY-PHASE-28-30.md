# VERIFY — PHASE 28 (PERSISTENT BRAIN) + PHASE 30 (HARNESS PARITY) — CROSS-VERIFICATION BY GLM

| | |
|---|---|
| Verifier | GLM (builder = Arena — builder ≠ verifier rule honored) |
| Branch | `verification/phase-28-30` (off main) |
| Tag | `pre-verify-28-30` |
| Zone | `docs/VERIFY-PHASE-28-30.md` ONLY |
| Mode | READ-ONLY. All probes regenerated from scratch — no builder probe file reused, no builder verification output trusted. |
| Verdicts | **Phase 28: PASS** (19/0 probe assertions) · **Phase 30: FAIL** (21/1 — probe 30-3b hook-wiring regression, root-caused) |

## 1. BASE SHA + REFS

```
$ git fetch origin
$ git rev-parse origin/main
6737419bed71e18901953db051fa6cfc5e2c666b        # = expected 6737419 (merge PR #18 restructure/file-structure) ✓

$ git rev-parse HEAD verification/phase-28-30 origin/main pre-verify-28-30
6737419bed71e18901953db051fa6cfc5e2c666b   (all four identical)

$ git ls-remote origin refs/heads/verification/phase-28-30 refs/tags/pre-verify-28-30
6737419bed71e18901953db051fa6cfc5e2c666b        refs/heads/verification/phase-28-30
6737419bed71e18901953db051fa6cfc5e2c666b        refs/tags/pre-verify-28-30
```

Base confirmed at `6737419`. Environment note: the operator sandbox had been reset between tasks, so the branch was materialized as a fresh worktree directly off `origin/main` — functionally identical to `checkout main && pull && checkout -b` (main == origin/main == 6737419, verified above).

## 2. METHOD SUMMARY — HOW PROBES WERE REGENERATED

1. **Located** each phase's code via log/path greps (raw in §3/§4). No builder artifact consulted; builder's `scripts/phase28-cycle-probe.mjs` and `scripts/phase30-self-evolve-probe.mjs` were neither read for logic nor executed.
2. **Read the contracts myself** from the source on `6737419` (cycle.js phase list, each of the 13 phase `run()` contracts, lint gate, consolidate clustering spec, take seams; hook catalog/registry/contract, adapter base contract, self-evolve guardrail/audit).
3. **Wrote my own probe suites** in the operator workspace, OUTSIDE the repo (zero repo pollution, zone-safe):
   - `/scripts/verify2830/probe-28.mjs` — 19 independent assertions (28-1 … 28-6), own fixtures built from the contracts.
   - `/scripts/verify2830/probe-30.mjs` — 22 independent assertions (30-1 … 30-5), own fixture skill files in `os.tmpdir()`, own fixture adapter via the factory.
4. **Negative checks written from the "what breakage would look like" direction** (gate containment for 28; fail-closed enforcement for 30).
5. **Checksums** computed with `sha256sum` over current post-restructure paths.
6. Where a probe failed, it is reported as FAIL with raw output. Nothing was fixed.

## 3. PHASE 28 — PERSISTENT BRAIN (BUILT BY ARENA)

### 3.1 Files found + delivering SHAs

Commits (all verified ancestors of main via `git merge-base --is-ancestor` — all YES):

```
688efecf phase-28(A): brain repo + page schema          26519583 phase-28(B): real vector index
4e392bd8 phase-28(C): zero-LLM typed-edge KG            2a717d4d phase-28(D): hybrid retrieval + fusion
541aa2ef phase-28(E): reranker                          17131c39 phase-28(F): fact taxonomy + hot memory
d852b9b1 phase-28(G): retrieval reflex + ambient recall 386059ec phase-28(H): memory verbs protocol
14ba24cd phase-28(I): dream cycle                       9253f727 phase-28(J): multi-source + soft-delete
e4a31892 phase-28(K): BrainBench evals + publish        808bf00e merge: phase-28 (persistent brain) — gate
```

Post-restructure location of the delivered tree (delivered pre-restructure under `brain/`, now `mind/brain/`, 86 tracked files), dream cycle at `mind/brain/cycle/`:

```
mind/brain/cycle/{cycle,index,budget}.js
mind/brain/cycle/phases/{lint,backlinks,sync,extract,extract-facts,resolve-symbol-edges,
  synthesize-concepts,recompute-emotional-weight,consolidate,propose-takes,grade-takes,embed,orphans}.js
mind/brain/repo/{index,schema,page,layout,compiled-truth,timeline}.js
mind/brain/hot/{index,kinds,recall,decay,extract-facts,supersession,mcp-meta}.js
mind/brain/index/{index,embedder,chunker,vector-store}.js + backends/
mind/brain/search/{hybrid,index,keyword,vector,rrf,mmr,recency-decay,dedup,boosts}.js + rerank/
mind/brain/kg/{index,extractor,frontmatter,verb-inference,watermark,extract-cli}.js
mind/brain/protocol/{index,verbs,envelope,errors,conformance,versioning}.js
mind/brain/multi/{index,source,isolation,soft-delete,acl}.js
mind/brain/evals/{index,brainbench,corpus,metrics}.js   mind/brain/publish/{index,html}.js
mind/brain/ambient/...                                   (reflex + ambient recall)
```

Scheduling evidence (Probe 28-2): `server/src/wiring/phase31-bootstrap.js` S3-CYCLE wires the dream cycle as cron job `w31-brain-cycle`, `cron: '0 3 * * *'` (03:00 daily), lane `memory`, handler `brain-cycle` → `createDreamCycle({ repo: state.repo, hot: state.hot, index: state.index }).run({ dryRun: false })`.

### 3.2 Probes 28-1 … 28-6 — raw output (own probe, own fixtures)

```
$ node /scripts/verify2830/probe-28.mjs   (GLM's own probe; worktree @ 6737419)

===== PROBE 28-1 dream cycle exists + callable =====
DECLARED_PHASE_ORDER = ["lint","backlinks","sync","extract","extract-facts","resolve-symbol-edges",
"synthesize-concepts","recompute-emotional-weight","consolidate","propose-takes","grade-takes","embed","orphans"]
PASS 28-1a: 13 phases registered — got 13
PASS 28-1b: names match spec order
  phase lint                       run=true gate=yes llmBacked=no
  phase backlinks                  run=true gate=no llmBacked=no
  phase sync                       run=true gate=no llmBacked=no
  phase extract                    run=true gate=no llmBacked=no
  phase extract-facts              run=true gate=no llmBacked=no
  phase resolve-symbol-edges       run=true gate=no llmBacked=no
  phase synthesize-concepts        run=true gate=no llmBacked=yes
  phase recompute-emotional-weight run=true gate=no llmBacked=no
  phase consolidate                run=true gate=no llmBacked=no
  phase propose-takes              run=true gate=no llmBacked=yes
  phase grade-takes                run=true gate=no llmBacked=yes
  phase embed                      run=true gate=no llmBacked=no
  phase orphans                    run=true gate=no llmBacked=no
PASS 28-1c: every phase .run is callable
PASS 28-1d: createDreamCycle factory exported

===== PROBE 28-2 scheduled run =====
PASS 28-2a: cron job w31-brain-cycle @ 0 3 * * * registered in bootstrap source
PASS 28-2b: dryRun plans all 13 phases without executing
run record: [{"n":"lint","ok":true,"status":"ok"},{"n":"backlinks","ok":true,"status":"ok"},
 {"n":"sync","ok":true,"status":"ok"},{"n":"extract","ok":true,"status":"ok"},
 {"n":"extract-facts","ok":true,"status":"ok"},{"n":"resolve-symbol-edges","ok":true,"status":"ok"},
 {"n":"synthesize-concepts","ok":true,"status":"ok"},{"n":"recompute-emotional-weight","ok":true,"status":"ok"},
 {"n":"consolidate","ok":true,"status":"ok"},{"n":"propose-takes","ok":true,"status":"ok"},
 {"n":"grade-takes","ok":true,"status":"ok"},{"n":"embed","ok":true,"status":"ok"},
 {"n":"orphans","ok":true,"status":"ok"}]
PASS 28-2c: full manual run against fixture brain completes without error

===== PROBE 28-3 consolidate phase =====
PASS 28-3a: spec constants — threshold=0.85 minCluster=2
cosine([1,0.1,0],[1,0.12,0]) = 0.999805 → same bucket? true
obscura bucket cluster sizes = [["f3"]] | market bucket = [["f2","f1"]]
PASS 28-3b-i: obscura bucket → f3 singleton (< MIN_CLUSTER_SIZE, no promotion)
PASS 28-3b-ii: market bucket → f1+f2 cluster (cos 0.9998 ≥ 0.85)
input facts: f1,f2,f3,f4 → output takes: [{"id":"take-9cd0ba253d9ee4c6","fact_ids":["f1","f2"],
  "entity":"jexi-market","threshold":0.85}]
PASS 28-3c: consolidate promotes exactly one take from the ≥2 cluster, claim = best (highest-confidence) fact

===== PROBE 28-4 propose + grade takes =====
propose-takes record: {"name":"propose-takes","ok":true,"durationMs":0,"budgetUsed":0.01,"status":"ok",
  "label":"injected LLM capability","details":{"skipped":false,"proposed":2}}
grade-takes record: {"name":"grade-takes","ok":true,"durationMs":0,"budgetUsed":0.02,"status":"ok",
  "label":"injected LLM capability","details":{"skipped":false,"graded":3}}
takes after grade: [{"id":"take-9cd0ba253d9ee4c6","graded":true},{"id":"llm-take-0","graded":true},
  {"id":"llm-take-1","graded":true}]
PASS 28-4a: propose-takes produced take objects (llm stub take-0/1 + consolidated take) — total takes=3
PASS 28-4b: grade-takes scored every take
PASS 28-4c: without LLM the seams skip honestly (label says NOT VERIFIED, no fabrication)

===== PROBE 28-5 persistence across restart =====
state bytes after run A: 1884
PASS 28-5a: post-restart instance reproduces byte-identical state (deterministic rehydration)
PASS 28-5b: cycle calls repo.sync() — state lands in the persistent store, not only in memory
PASS 28-5c: re-run does not duplicate takes (take-id dedup holds)

===== PROBE 28-6 negative check (gate containment) =====
records with forced lint failure: [{"n":"lint","status":"gate-aborted"}]
audit: [{"phase":"lint","event":"gate-aborted","code":"E_LINT_GATE","message":"glm-negative-probe","retryable":false}]
PASS 28-6a: broken lint aborts the cycle at the gate — NO later phase runs
PASS 28-6b: no takes can be produced from a gated-broken cycle (mutation that cannot happen by accident)

===== PHASE 28 PROBE SUMMARY: 19 PASS / 0 FAIL =====
```

Fixture notes (transparency): 28-2c initially gate-aborted in MY fixture — the lint gate requires pages shaped `{kind, slug, title, compiledTruth}`; my first fixture page was malformed. That was a verifier fixture bug, corrected in the probe; the gate behavior itself is exactly the designed rejection path (and is what 28-6 then proves deliberately). Probe-level fact worth recording: `phaseFilter` bypasses the gate by design (a single-phase filter run of `consolidate` alone does not pass through lint) — flagged under Findings as a design observation, not a failure.


### 3.3 Independent checksums (sha256sum, current paths)

```
9b32b91aa8d957dcb4c1872e76087581ee17797da06c3fa6e8e62dd497d919b4  mind/brain/cycle/cycle.js
2304d8ef3d9b7ad335c68d1a9d2ab61e63eae2c4d78f9f3d142ec0acd3349a9f  mind/brain/cycle/index.js
ce3bf3959bcf97f10fb832d5a117bd75e4fc0217812bd6476ec85f12e733547f  mind/brain/cycle/budget.js
cfbb97adec13c22ed6bdd7f8999a158b4628fa02b04e9c7907f0744d0962e03a  mind/brain/cycle/phases/lint.js
6d2d024a0ffde7b63804ae06f2977f16a8dc712eb4cffe6750b60b3e24bf731b  mind/brain/cycle/phases/consolidate.js
4651cb9385a736dfc1af71618463bd6148701e5b926f4cfa38d69a4597e703fb  mind/brain/cycle/phases/propose-takes.js
71879dcafc1515165b0520f87e4d5e11380758c4f05a522c39faa149653f26a7  mind/brain/cycle/phases/grade-takes.js
97cd8f180c46d89b7ec62d40b115cea2d3f919314a9245f51d1a6e4b387a3897  mind/brain/repo/index.js
941630ce9f96e4f4af087e83002d73099eb52894dc620b582d52379236b2bf35  mind/brain/repo/schema.js
ec853eec4e66e987e12c11e2b96f1f02617dacceb9a81d262fb7b4f6ccedddeb  mind/brain/repo/page.js
75d6334c0199d7c444d81a61b9ef16b5b3703c42b23690fe20eb42aef4265ca2  mind/brain/hot/index.js
34289a4136cb0026871d297c54e708703cfe0faa1616b58b8c2d5133703046b3  mind/brain/hot/kinds.js
a2393561881075b25b89d3a2752ae501cc196788d6585b35473829dc71b95f04  mind/brain/index/index.js
7f326a885acf19e7413e26483f9667cf828bc4dc537fa25b0b5cce7f62ea9a28  mind/brain/index/embedder.js
a96fdfa0e081f1203be818d760be19da71bcd1476ebbebf8984a715e6b962e59  mind/brain/search/hybrid.js
f3b635d587d39107bd536eb2c9480e5bf670b7177cc5c6d4b525ee25fd8fcdd4  mind/brain/search/rrf.js
cb64bfe3f3bac1ed1660c9a2d17b6035f86e7dc20c0e146315843f1246667c03  mind/brain/kg/index.js
1863f83474c7a81ba0f2ad1daecfd188c561d92dd18ce18f3a8e372165aeea26  mind/brain/protocol/verbs.js
fe76374073ad3fad6fe897a4cf902b733a0fe940f0779c9f962c4710de20f4f2  mind/brain/multi/soft-delete.js
fa0650c42ad011665f3ff214cd0ba338d3eb46f4fee15d1ea774091006d92920  mind/brain/evals/brainbench.js
```


### 3.4 PHASE 28 VERDICT: **PASS**

All six probes ran; 19/19 assertions passed; evidence recorded above. The dream cycle exists, is callable, is scheduled, consolidates per spec, proposes/grades honestly (no fabrication without an injected LLM), reproduces state deterministically across simulated restarts, and its gate containment behaves correctly under the negative probe.

## 4. PHASE 30 — HARNESS PARITY (BUILT BY ARENA)

### 4.1 Files found + delivering SHAs

Commits (all verified ancestors of main — all YES):

```
a45089bf phase-30(A): 30-hook catalog registry     0dcab4d7 phase-30(B): skill tool scoping (+B-fix 4af3280a)
6cdd3789 phase-30(C): subagent contract fields     1b2debc9 phase-30(D): path-scoped rules
1817a4bd phase-30(E): subagent worktree isolation  72021248 phase-30(F): permission + command lifecycle hooks
23c13a85 phase-30(G): self-evolving agent pattern  b3b17930/a0c2ef14/d1b2b96a/0973bf51 phase-30(H) + fixes
115b1fc7 merge: phase-30 (harness parity) — gate
```

Post-restructure tree (`harness/`, 92 tracked files):

```
harness/adapters/          _base.adapter.js + 14 shipped adapters + index.js
harness/forge/             dispatch, index, vendor (+ forgejo/github vendor)
harness/hardening/         forgejo/, madtea/, ralph/ (incl. ci-doctor)
harness/parity/hooks/      catalog.js (30 events), contract.js, registry.js, index.js
harness/parity/skills/     scoping.js, enforcement.js, index.js
harness/parity/subagent/   contract.js, enforcement.js, index.js
harness/parity/rules/      rules.js, scope.js, injection.js, index.js
harness/parity/worktree/   create.js, cleanup.js, hooks.js, index.js
harness/parity/lifecycle/  permission-denied.js, prompt-expansion.js, post-tool-batch.js, index.js
harness/parity/self-evolve/ evolve.js, guardrail.js, audit.js, index.js
harness/refine/            planner.js, applier.js, rollback.js, storage.js, index.js
harness/state/             index.js, journal.js, memory.js, prompt-notes.js, skills.js, subagent-specs.js
hook registrations data:   infra/hooks/hooks.json + infra/hooks/scripts/** (moved here by restructure PR #18)
```

### 4.2 Probes 30-1 … 30-5 — raw output (own probe, own fixtures)

```
$ node /scripts/verify2830/probe-30.mjs   (GLM's own probe; worktree @ 6737419)

===== PROBE 30-1 harness parity (fixture adapter, match/mismatch) =====
shipped adapters: claude-code, codex, cursor, gemini, opencode, openclaw, aider, windsurf, copilot, kimi, hermes, osaurus, antigravity, mistral-vibe
PASS 30-1a: every shipped adapter conforms to the base contract — 14 adapters
PASS 30-1b: fixture adapter built via factory CONFORMS (match)
PASS 30-1c: malformed adapter rejected (mismatch) — adapter "broken" invalid: displayName must not be empty
PASS 30-1d: all 30 registry entries validate against the hook contract (match) — errors=0
PASS 30-1e: tampered spec detected (mismatch) — ["catalog[0]: no-op stub contract.return must be none"]

===== PROBE 30-2 self-evolving agent (owner-scoped, PROV-O audited) =====
owner update result: {"updated":[{"skillId":"jexi-market-optimiser","fromVersion":1,"toVersion":2,
 "decisionId":"decision-001","diff":"<diff>"}],"audited":"decision-001","decisionIds":["decision-001"],"refused":[]}
PASS 30-2a: owner update applied (v1 → v2) + skill updated
PASS 30-2b: audit decision id recorded
audit entry: {"decisionId":"decision-001","agentId":"agent-a","skillId":"jexi-market-optimiser",
 "diff":{"beforeSha256":"38e28a2c...","afterSha256":"a68063e9...","beforeBytes":138,"afterBytes":142,
 "addedBytes":21,"removedBytes":17,"totalByteDelta":38,"exact":true,"limit":4096},
 "reason":"glm probe: legitimate owner update","runId":"glm-run-1",
 "relativePath":"jexi-market-optimiser/SKILL.md","rolledBack":false, ... provenance attached}
PASS 30-2c: PROV-O provenance record attached to every skill change
PASS 30-2d: audit entry references agent + run — agentId=agent-a runId=glm-run-1
cross-owner attempt: {"skillId":"jexi-market-optimiser","code":"E_NOT_OWNER",
 "reason":"agent agent-b does not own skill jexi-market-optimiser"}
PASS 30-2e: agent CANNOT update another owner's skill (E_NOT_OWNER)

===== PROBE 30-3 the 30-hook wiring table (current state) =====
PASS 30-3a: catalog declares exactly 30 events
(30-row table in §4.3)
TOTAL wired: 0/30 — no-op stubs: 30/30
FAIL 30-3b: EXPECTED per audit = 5 wired + 25 explicit stubs — ACTUAL 0 wired / 30 stubs → PROBE FAIL (regression, see root cause below) — wired=0 stubs=30
PASS 30-3c: mitigating — every no-op IS explicitly marked (stub:true), none silent
registry reads: /home/z/my-project/jexi-verify2830/hooks/hooks.json | exists: false | actual file: infra/hooks/hooks.json exists = true
PASS 30-3d: root cause confirmed — registry URL targets pre-restructure path hooks/hooks.json (gone); data now at infra/hooks/hooks.json

===== PROBE 30-4 core.md guardrail =====
self-evolve attempt on core.md → E_INVALID_SKILL_PATH: skill path must stay under the fixture root and end in SKILL.md: /home/z/my-project/jexi-verify2830/mind/brain/self/core.md
PASS 30-4a: self-evolve refuses a path outside the skill root / non-SKILL.md (core.md unreachable)
guard.assertWritable(core.md) → E_SELF_IMMUTABLE: brain/self/core.md is immutable from JEXI's side (actor self-evolve); only Lewis edits it
PASS 30-4b: core.md write refused with E_SELF_IMMUTABLE
PASS 30-4c: isProtectedPath(core.md)=true, voices.md=false

===== PROBE 30-5 negative check (fail-closed skill tool enforcement) =====
unlisted tool call → E_TOOL_NOT_ALLOWED: skill "glm-skill" cannot call tool "Bash": tool "Bash" denied: no allowedTools pattern matched
PASS 30-5a: unlisted tool REFUSED (fail-closed) — if parity breaks, this test fails
PASS 30-5b: listed tool allowed (positive control)
bare "*" pattern → E_INVALID_PATTERN: invalid allowed-tools pattern "*": expected ToolName or ToolName(argument-pattern)
PASS 30-5c: bare wildcard "*" is INVALID by design (fail-closed pattern grammar, no blanket grants)
PASS 30-5d: scoped prefix glob Bash(git*) allowed for git commands (documented wildcard semantics)
PASS 30-5e: same skill denied for non-git command (glob does not over-grant) — E_TOOL_NOT_ALLOWED

===== PHASE 30 PROBE SUMMARY: 21 PASS / 1 FAIL =====
```


### 4.3 The 30-hook table (current state, from my probe run)

Registry source of truth for this table: my own run of `hooks.list()` from `harness/parity/hooks/registry.js` @ `6737419`. All 30 rows are explicit stubs; "evidence" column quotes the registry's own marker per event (handlers exist for none — see F1).

```
event              | wired?    | evidence
PreToolUse         | NO (stub) | stub:true, contract.return=none (explicit, non-silent) — data exists in infra/hooks/hooks.json but unread (F1)
PermissionRequest  | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
PostToolUse        | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
PostToolUseFailure | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
UserPromptSubmit   | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
Notification       | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
Stop               | NO (stub) | stub:true, contract.return=none (explicit, non-silent) — data exists, unread (F1)
SubagentStart      | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
SubagentStop       | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
PreCompact         | NO (stub) | stub:true, contract.return=none (explicit, non-silent) — data exists, unread (F1)
PostCompact        | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
SessionStart       | NO (stub) | stub:true, contract.return=none (explicit, non-silent) — data exists, unread (F1)
SessionEnd         | NO (stub) | stub:true, contract.return=none (explicit, non-silent) — data exists, unread (F1)
Setup              | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
TeammateIdle       | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
TaskCreated        | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
TaskCompleted      | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
ConfigChange       | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
WorktreeCreate     | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
WorktreeRemove     | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
InstructionsLoaded | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
Elicitation        | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
ElicitationResult  | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
StopFailure        | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
CwdChanged         | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
FileChanged        | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
PermissionDenied   | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
UserPromptExpansion| NO (stub) | stub:true, contract.return=none (explicit, non-silent)
PostToolBatch      | NO (stub) | stub:true, contract.return=none (explicit, non-silent)
MessageDisplay     | NO (stub) | stub:true, contract.return=none (explicit, non-silent)

TOTAL wired: 0/30 — no-op stubs: 30/30 (all explicit; count of silent no-ops: 0; count of no-ops vs audit expectation: +5 regressions on PreToolUse, PreCompact, SessionStart, SessionEnd, Stop)
```

Reference — the 8 registrations waiting in `infra/hooks/hooks.json` (data intact, unreachable per F1):
`pre.dev-server-blocker → PreToolUse(terminal.execute)`, `+3 more PreToolUse` (git-push-reminder, pre-commit-quality, tmux-reminder), `pre.compact.save-checkpoint → PreCompact`, `session-end.persist-memory → SessionEnd`, `session-start.restore-memory → SessionStart`, `stop.evaluate-session → Stop`.


### 4.4 Independent checksums (sha256sum, current paths)

```
68d566d217678ee874604bee3df967c07b5070ac7731d58083b8c2ca01f0905e  harness/parity/hooks/catalog.js
6472836977404ad3311637fcfbc0d3ef03bd259b6661d4eb94e5f968618c2f37  harness/parity/hooks/contract.js
3f18ce701d65e0d08db71ba3cec34a8a061a6465e8237afce5944309af5ca15a  harness/parity/hooks/registry.js
60f3f198849b0ee0d8504ca390649f7d4fd78c9bf5d0b9fbce46ca9daa06299a  harness/parity/hooks/index.js
a32617f4665f0b3428dcc40a551cebc531a102fbaaadd9e9bdf2f20a7cd4cde9  harness/parity/self-evolve/evolve.js
aa72511191aa2cbff1d85efaac016b6c1819b24edfead0b0c37a82fffec5df06  harness/parity/self-evolve/guardrail.js
554270cafc7b096d80a9d623e6a394e496c7d32d941796a65972463617afd7ae  harness/parity/self-evolve/audit.js
e874ee17c6fe9bd2cbfbf8ebbaccfa87d0a3504404ffd3a152c90118b16dc267  harness/parity/self-evolve/index.js
aeab5b2d174bf48d1a512248964b65dbfb6735590da8b1bc0d04c982a9dbab44  harness/parity/skills/scoping.js
8ae2b1508bf6f5b567f732e1cbca7a4e22ec9df503c7d2d0e59fc40dd3756635  harness/parity/skills/enforcement.js
e0d9668e2d7f578ff9f0ec112e243b82dae792c49a00352580a0e8bbbb73168a  harness/parity/subagent/contract.js
c4cc85efed184e129376b4b20a849f1de9311db9f518d44e63998fcc42e40b79  harness/parity/subagent/enforcement.js
82255b7be69df89a3bcbff5deb2f290544c457d62e191179808927144bd52455  harness/parity/worktree/create.js
e2360b48d00b5db5e4e389f483ec9edf4d609293225e639cd396cb722f147562  harness/parity/worktree/cleanup.js
a493daae79904d4006571e55da93d599dea337e896e93e519d38d2ef77183369  harness/parity/worktree/hooks.js
b23820ac61d33032a1a9cc9d5e25743639fd3e9216a34b019ae5bd9737c2db91  harness/parity/lifecycle/permission-denied.js
c099f2b520e8bdef18ec1aaacff59c644c6a2ab19b886d1a3d20c8ba8ef96150  harness/parity/lifecycle/prompt-expansion.js
7e40c0353b996e1e7f88b25bd7c452e825e6e39b54b3b31ff56b22a511a55707  harness/parity/lifecycle/post-tool-batch.js
e5431dcc6e34592527ca78067471ec67b58162ce1c74ec1881163dd179c93dd4  harness/parity/rules/rules.js
2169bdddcf32f52445e4ffa378ea88d48b4097c636f2361691ad9cbc605243ef  harness/parity/rules/scope.js
c3d349b7e7b2cb8133b528d6f54c35fd23dfc2bf34ebdc6bcce7b128d5ba14a5  harness/parity/rules/injection.js
4345db0eb3645f7d7b70dcb865ea56ef4e4b5b0f8c4ecc9af19fdc2806e1a115  harness/adapters/_base.adapter.js
ecf967ed7e18e1a61f02079e5faa9f7e9250628da83eae3a2f4049bb56a269ea  harness/state/index.js
5373acbfd56e2bc4e6ec151dc6871aaa45dd1a58560bb6fc54641556b4b29dcc  harness/state/journal.js
17dcc6c05d09f6a61283967d7544b1e9dd6381dc33ea6483a3bbc62b699b36ad  harness/refine/planner.js
6d3438852f019380873750a88b81c3deac00f5b616007d5c4a238d0614b2464c  harness/refine/applier.js
```


### 4.5 PHASE 30 VERDICT: **FAIL**

Probe 30-3 **failed**: the hook registry wires **0 of 30** events. At the phase-30 gate, 5 events were wired (PreToolUse ×4, PreCompact, SessionStart, SessionEnd, Stop — 8 registrations); today ALL 30 resolve to explicit stubs. Root cause isolated below (Findings F1). Every other probe (adapter parity, self-evolve owner-scoping + PROV-O audit, core.md guardrail, fail-closed enforcement) passed with raw evidence. Per the shared definition — a partial pass is a FAIL with a findings list — Phase 30 = **FAIL**.

## 5. FINDINGS

**F1 — REGRESSION (cause of the FAIL): the hook registry lost access to its registration data after the restructure.**
`harness/parity/hooks/registry.js` (line 7) resolves its data file relative to the PRE-restructure layout:

```js
const PHASE7_REGISTRY_URL = new URL('../../../hooks/hooks.json', import.meta.url);
// resolves to  <repo-root>/hooks/hooks.json  — which no longer exists:
$ node -e "console.log(new URL('../../../hooks/hooks.json', pathToFileURL(ROOT+'/harness/parity/hooks/registry.js')).pathname)"
/home/z/my-project/jexi-verify2830/hooks/hooks.json
$ ls hooks/hooks.json → No such file or directory
$ ls infra/hooks/hooks.json → exists (moved here by restructure PR #18: hooks/ → infra/hooks/)
```

`readPhase7Registrations()` catches the read failure and returns `{registrations: [], error}` — so `buildRegistry()` silently degrades every event to a stub. Result: **0/30 wired** (was 5/30 with 8 registrations at the gate). Mitigating: the degradation is HONEST — every stub is explicitly flagged `stub: true` with `contract.return: none`; nothing pretends to run. One-line path fix (not applied — read-only), available to the lead if ruled: point the URL at `../../../infra/hooks/hooks.json`.

**F2 — Design observation (Phase 28, no action required): `phaseFilter` bypasses the lint gate by construction.** `selectedPhases(filter)` returns only the requested phases, so a filtered run that excludes `lint` never executes the gate. This is deterministic, documented-in-code behavior (the filter is a maintenance seam), but it means single-phase runs are not gate-covered. The full scheduled run always passes through the gate.

**F3 — Observation (Phase 30, positive): enforcement grammar is stricter than the spec's own example.** Bare `"*"` is an INVALID pattern (`E_INVALID_PATTERN`) — blanket grants are impossible; wildcards exist only as scoped prefix/path globs (`Bash(git*)`, `Read(/docs/**)`). Good fail-closed property; recorded so future scopes don't assume `"*"` works.

**F4 — Observation (Phase 30, data-only): `infra/hooks/scripts/` ships 8 script files** (dev-server-blocker, git-push-reminder, pre-commit-quality, tmux-reminder, save-checkpoint, restore-memory, persist-memory, evaluate-session) — real implementations; they are the commands the 8 registrations reference. They are unreachable only because of F1's path break, not because they are missing.

## 6. NOT VERIFIED

- **N1 — Dream cycle live cron fire.** Probe 28-2 proves the cron job registration exists in the bootstrap source and that a manual fixture run completes; it does not prove a 03:00 scheduler tick fires the handler inside a booted server (would require booting the full server with scheduler in this sandbox).
- **N2 — Phase 28 against a REAL brain store.** All Phase 28 probes ran against my fixtures built from the source contracts; the real `mind/brain/repo` store path was not populated on disk during verification (read-only constraint).
- **N3 — LLM-backed phases with a real model.** `synthesize-concepts` / `propose-takes` / `grade-takes` were exercised with an injected fixture LLM only (the honest no-LLM path is also asserted). No real model call was made.
- **N4 — Harness runtime hooks in a live Claude-Code-class harness.** Verified the registry surface and its data; did not verify the 8 scripts execute under an actual harness host.
- **N5 — `harness/forge` / `harness/hardening` (forgejo/madtea/ralph) runtime behavior.** Out of the named probe list; only file location + commit lineage recorded. Not probe-verified.

## 7. DO-NOT LIST COMPLIANCE

- Builder ≠ verifier: verified 28 + 30 (Arena's work) only; did NOT touch Phase 31 (Arena's section). Section B ignored. ✓
- No builder probe reused: both probe suites were written from the spec + source contracts; builder probe files never executed. ✓
- READ-ONLY: zero code edits; the ONLY change on this branch is this doc. ✓ (verified by `git diff --stat origin/main..HEAD`)
- No merges, no deletions, no branch rewrites, no new credentials, no new dependencies. ✓
- One commit: this report only. ✓
- Zone: `docs/VERIFY-PHASE-28-30.md` ONLY. ✓
- Raw output only, English only. ✓
- STOP after this report — awaiting lead. ✓
