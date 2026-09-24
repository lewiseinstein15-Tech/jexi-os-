# VERIFY — PHASE 30 + 31 — RE-VERIFY AFTER RESIDUAL FIX

- **Verifier**: GLM (Section A lineage — builder of the fix = Arena, therefore out for both phases) — builder ≠ verifier ✅
- **Fix under test**: Arena `bfdeb95` ("fix: restructure residuals — registry path, command modules, probe scripts, new URL(spec) sweep"), merged to main as `6d65032` (PR #19)
- **Branch**: `verification/phase-30-31-reverify` · **Tag**: `pre-verify-30-31` · **Zone**: this document only
- **Date**: 2026-09-24

- **VERDICT: Phase 30 = PASS** (52/52 probe checks, 0 failed — including the previously failed 30-3b)
- **VERDICT: Phase 31 = PASS** (55/55 probe checks, 0 failed — including the previously failed 31-4 and 31-7)
- **F7 class sweep = FAIL by the strict letter** (36/37 literal `new URL(spec, import.meta.url)` targets exist) — the single unresolved target is the VikingFs **default data root**, which is created on first construction (`fs.mkdirSync(root, { recursive: true })`); sandbox proof included in §5. Classified: **not a restructure residual, not a dead reference** — ruling left to the lead.

Per the shared rule, both phase verdicts above are computed over the named probes only; the F7 sweep carries its own verdict line and does not gate either phase.

---

## 1. STEP 0 — BASE + REFS

```
git fetch origin
git checkout main && git pull origin main
HEAD        = 6d650326af918167265b815e7462af9ae639e588
origin/main = 6d650326af918167265b815e7462af9ae639e588   (expected 6d65032 ✅ — main had NOT moved between issue and step 0)

git log --oneline -3 main
6d650326 Merge pull request #19 from lewiseinstein15-Tech/fix/restructure-residuals
bfdeb95c fix: restructure residuals — registry path, command modules, probe scripts, new URL(spec) sweep
6737419b Merge pull request #18 from lewiseinstein15-Tech/restructure/file-structure

git merge-base --is-ancestor bfdeb95 main   → exit 0 (fix commit present on main)

branch  verification/phase-30-31-reverify = 6d650326 (pushed, ls-remote verified)
tag     pre-verify-30-31                  = 6d650326 (pushed, ls-remote verified)
6d650326af918167265b815e7462af9ae639e588        refs/heads/verification/phase-30-31-reverify
6d650326af918167265b815e7462af9ae639e588        refs/tags/pre-verify-30-31
```

**Environment bring-up (disclosed, not a repo edit).** `node_modules/` is gitignored and absent from snapshots. Root tree was already present; `npm --prefix server ci --no-audit --no-fund` restored the server's **own lockfile-pinned** tree (log: `runlogs/npm-server-ci.log`; `git status --porcelain` stayed empty throughout — node_modules ignored at `.gitignore:2-3`). No manifest changed, no new dependency added.

**Runtime (this session):** ambient Node `v24.21.0` ≥ declared floor `22.5` → the W36 gate passes **honestly** (no version shim needed, unlike Arena's ambient v20.20.2). `node:sqlite` IS available in this runtime.

---

## 2. METHOD — how the probes were (re)generated

- **Every probe was regenerated from the spec for this run.** No prior probe file was reused — not my previous Phase 30 suite, not Arena's `/tmp` probes, and no builder probe (`scripts/phase31-scope-*.mjs`, `phase30-rules-probe.mjs`, …) was executed as verification evidence. The new suite lives entirely **outside the repo** (`scripts/verify3031re/*.mjs`): `probe30.mjs`, `boot31.mjs` + `probe31.mjs`, `sweep-f7.mjs`, shared `lib.mjs`.
- Boot probes redirect ALL runtime state outside the tree (`runtimeRoot` under the probe dir, caches in `os.tmpdir()`); the repo working tree stayed byte-clean for the whole run (verified: `git status --porcelain` empty before the commit).
- Where a probe could self-validate, a **control** was run: 31-3 executes the same assertions against the PRE-FIX store (`852035^` — extracted from git to tmp) proving the probe detects the defect it targets; 31-7 injects a synthetic FAIL-SOFT line into a copy of the journal proving the negative check fires.
- **Spec-ambiguity note ("wiring hooks (0)–(17)")** — same interpretation as Arena's recorded one: the repository contains no literal 0–17 hook enumeration; the authoritative wiring surface is the **39-key `wired` map** returned by `initPhase31Wiring()` (scope numbering is `0,1,…,17`, `16.5`, `19`). Probe 31-4-RE therefore verifies that surface, per hook, with boot-journal evidence. If the lead intended a different enumeration, this part must be re-issued.

---

## 3. PHASE 30 RE-VERIFY

### 3.1 Probe 30-3b-RE — hook registry reads from the correct path — **PASS**

Static + behavioral double proof. Static: the URL spec now resolves to the shipped registration file. Behavioral: a dead path degrades ALL 30 events to stubs (the pre-fix failure mode), so 5 mapped events + 4 carried PreToolUse handlers can only appear if the file was actually read.

```
registry.js URL spec resolves to infra/hooks/hooks.json — spec="../../../infra/hooks/hooks.json"
  -> <repo>/infra/hooks/hooks.json exists=true        PASS
catalog shows 5 mapped events — mapped=5 [PreToolUse, Stop, PreCompact, SessionStart, SessionEnd]   PASS
catalog shows 25 stubs — stubs=25                                                    PASS
catalog total = 30 events — total=30                                                 PASS
PreToolUse carries its 4 shipped registrations —
  ids=["pre.dev-server-blocker","pre.tmux-reminder","pre.git-push-reminder","pre.pre-commit-quality"] PASS
registry.validate() reports valid — { valid: true }  (mapping complete, no duplicate ids)           PASS
mapped event set == {PreToolUse, SessionStart, SessionEnd, Stop, PreCompact}                        PASS
```

Raw — PreToolUse handlers as returned by `registry.get('PreToolUse')`:

```json
[
  { "id": "pre.dev-server-blocker",   "matcher": "terminal.execute", "command": "node hooks/scripts/pre-tool-use/dev-server-blocker.js",   "exitBehavior": "block", "timeout": 5000,  "async": false, "enabled": true, "return": "block" },
  { "id": "pre.tmux-reminder",        "matcher": "terminal.execute", "command": "node hooks/scripts/pre-tool-use/tmux-reminder.js",        "exitBehavior": "warn",  "timeout": 5000,  "async": false, "enabled": true, "return": "none" },
  { "id": "pre.git-push-reminder",    "matcher": "terminal.execute", "command": "node hooks/scripts/pre-tool-use/git-push-reminder.js",    "exitBehavior": "warn",  "timeout": 5000,  "async": false, "enabled": true, "return": "none" },
  { "id": "pre.pre-commit-quality",   "matcher": "terminal.execute", "command": "node hooks/scripts/pre-tool-use/pre-commit-quality.js",   "exitBehavior": "block", "timeout": 30000, "async": false, "enabled": true, "return": "block" }
]
```

**PROBE 30-3b-RE RESULT: PASS**

### 3.2 Probe 30-3-full-RE — the 30-hook table — **PASS**

Full table as emitted by the probe (`id | wired? | stub? | evidence`), exactly 30 rows:

```
PreToolUse           | YES | wired | handlers=[pre.dev-server-blocker, pre.tmux-reminder, pre.git-push-reminder, pre.pre-commit-quality] return=block
PermissionRequest    | NO  | stub  | no Phase 7 registration for this event (declared stub)
PostToolUse          | NO  | stub  | no Phase 7 registration for this event (declared stub)
PostToolUseFailure   | NO  | stub  | no Phase 7 registration for this event (declared stub)
UserPromptSubmit     | NO  | stub  | no Phase 7 registration for this event (declared stub)
Notification         | NO  | stub  | no Phase 7 registration for this event (declared stub)
Stop                 | YES | wired | handlers=[stop.evaluate-session] return=none
SubagentStart        | NO  | stub  | no Phase 7 registration for this event (declared stub)
SubagentStop         | NO  | stub  | no Phase 7 registration for this event (declared stub)
PreCompact           | YES | wired | handlers=[pre-compact.save-checkpoint] return=none
PostCompact          | NO  | stub  | no Phase 7 registration for this event (declared stub)
SessionStart         | YES | wired | handlers=[session-start.restore-memory] return=none
SessionEnd           | YES | wired | handlers=[session-end.persist-memory] return=none
Setup                | NO  | stub  | no Phase 7 registration for this event (declared stub)
TeammateIdle         | NO  | stub  | no Phase 7 registration for this event (declared stub)
TaskCreated          | NO  | stub  | no Phase 7 registration for this event (declared stub)
TaskCompleted        | NO  | stub  | no Phase 7 registration for this event (declared stub)
ConfigChange         | NO  | stub  | no Phase 7 registration for this event (declared stub)
WorktreeCreate       | NO  | stub  | no Phase 7 registration for this event (declared stub)
WorktreeRemove       | NO  | stub  | no Phase 7 registration for this event (declared stub)
InstructionsLoaded   | NO  | stub  | no Phase 7 registration for this event (declared stub)
Elicitation          | NO  | stub  | no Phase 7 registration for this event (declared stub)
ElicitationResult    | NO  | stub  | no Phase 7 registration for this event (declared stub)
StopFailure          | NO  | stub  | no Phase 7 registration for this event (declared stub)
CwdChanged           | NO  | stub  | no Phase 7 registration for this event (declared stub)
FileChanged          | NO  | stub  | no Phase 7 registration for this event (declared stub)
PermissionDenied     | NO  | stub  | no Phase 7 registration for this event (declared stub)
UserPromptExpansion  | NO  | stub  | no Phase 7 registration for this event (declared stub)
PostToolBatch        | NO  | stub  | no Phase 7 registration for this event (declared stub)
MessageDisplay       | NO  | stub  | no Phase 7 registration for this event (declared stub)

exactly 5 wired / 25 stubs across the 30-row table — wired=5 stub=25 total=30   PASS
```

All 25 stubs are EXPLICIT (registry `stub:true` flag from "no registration for this event") — zero silent stubs. **PROBE 30-3-full-RE RESULT: PASS**

### 3.3 Probe 30-1-RE — harness parity — **PASS**

```
registry ships 14 adapters — count=14
  [claude-code, codex, cursor, gemini, opencode, openclaw, aider, windsurf,
   copilot, kimi, hermes, osaurus, antigravity, mistral-vibe]
adapter claude-code conforms — format=markdown root=home      PASS
adapter codex conforms — format=markdown root=home            PASS
adapter cursor conforms — format=mdc root=project             PASS
adapter gemini conforms — format=markdown root=home           PASS
adapter opencode conforms — format=markdown root=home         PASS
adapter openclaw conforms — format=markdown root=home         PASS
adapter aider conforms — format=markdown root=project         PASS
adapter windsurf conforms — format=markdown root=project      PASS
adapter copilot conforms — format=markdown root=project       PASS
adapter kimi conforms — format=markdown root=home             PASS
adapter hermes conforms — format=markdown root=home           PASS
adapter osaurus conforms — format=markdown root=home          PASS
adapter antigravity conforms — format=markdown root=home      PASS
adapter mistral-vibe conforms — format=markdown root=home     PASS
fixture VALID adapter passes the contract (match)             PASS
malformed adapter REJECTED (missing convert()) — TypeError "convert() must be a function"      PASS
malformed adapter REJECTED (bad format) — "format must be one of markdown | mdc | yaml | json" PASS
malformed adapter REJECTED (bad supports key) — "supports.mcp must be a boolean"               PASS
```

**PROBE 30-1-RE RESULT: PASS (18/18 checks)**

### 3.4 Probe 30-2-RE — self-evolving agent — **PASS**

Fixture skill in `os.tmpdir()` (repo untouched), `createSelfEvolve({ root })`:

```
INTRUDER afterRun (raw):
{ "updated": [], "audited": null, "decisionIds": [],
  "refused": [ { "skillId": "reverify-skill", "code": "E_NOT_OWNER",
                 "reason": "agent intruder-agent does not own skill reverify-skill" } ] }   PASS (refused, E_NOT_OWNER)

OWNER afterRun (raw, abridged):
{ "updated": [ { "skillId": "reverify-skill", "fromVersion": 1, "toVersion": 2,
    "decisionId": "decision-001",
    "diff": { "beforeSha256": "942be5cb…", "afterSha256": "8530fc1a…",
              "totalByteDelta": 79, "exact": true, "limit": 4096 } } ],
  "audited": "decision-001", "decisionIds": ["decision-001"], "refused": [] }              PASS (accepted)

AUDIT (PROV-O provenance on the accepted decision):
{ "decisionId": "decision-001", "agentId": "owner-agent", "skillId": "reverify-skill",
  "runId": "run-reverify-2", "relativePath": "reverify-skill/SKILL.md", "rolledBack": false,
  "provenance": { "agent": "agent:owner-agent",
                  "activity": "activity:decision-record",
                  "source": "decisions.record(self-evolve:owner-agent:reverify-skill)",
                  "when": "run-reverify-2:1", "parent": null } }                          PASS
```

Owner-scoping enforced (E_NOT_OWNER for non-owner), acceptance path works, and every accepted update lands as a Phase 14 decision **with a PROV-O record** (`agent / activity / source / when / parent`). **PROBE 30-2-RE RESULT: PASS**

### 3.5 Probe 30-4-RE — core.md guardrail — **PASS**

```
core.md parses with all declared facts — facts=11 name=JEXI version=1.6.2                  PASS
every fact carries PROV-O attribution — prov lines complete                                PASS
NOTE core.md sha256[16]=6e50cb8e54f726fb bytes=959
assertWritable(brain/self/core.md) throws E_SELF_IMMUTABLE — code=E_SELF_IMMUTABLE         PASS
twin path brain/self/core.md is also protected — code=E_SELF_IMMUTABLE                     PASS
assertWritable(tmp/not-core.md) passes — guard is targeted, not over-blocking              PASS
self-evolve REFUSES a path escaping the skill root — codes=["E_INVALID_SKILL_PATH"]        PASS
  (raw refusal: "skill path must stay under the fixture root and end in SKILL.md: /tmp/…/../outside/SKILL.md")
self-evolve REFUSES a brain/self/core.md target — codes=["E_INVALID_SKILL_PATH"]           PASS
```

**PROBE 30-4-RE RESULT: PASS**

### 3.6 Probe 30-5-RE — negative check — **PASS**

```
undeclared allowedTools FAILS CLOSED (denied)  — "allowedTools is not declared"            PASS
empty allowlist FAILS CLOSED (denied)          — "allowedTools declares no tools"          PASS
enforcement.assert throws E_TOOL_NOT_ALLOWED   — code=E_TOOL_NOT_ALLOWED                   PASS
bare '*' is rejected (E_INVALID_PATTERN)                                                   PASS
allowlist containing '*' throws E_INVALID_PATTERN                                          PASS
path glob ALLOWS a path inside the root        — files.read(/workspace/**) ~ /workspace/a/b.txt   PASS
path glob DENIES a sibling prefix path         — /workspace-evil/x denied                  PASS
path glob ALLOWS the exact root path           — /workspace                                PASS
path glob DENIES relative paths                — workspace/a denied                        PASS
prefix glob matches its prefix                 — run* ~ run-tests --fast                   PASS
prefix glob denies non-prefix                  — run* !~ reset-all                         PASS
CONTROL: allowlisted call passes enforcement (not over-blocking) — passed                  PASS
```

**PROBE 30-5-RE RESULT: PASS**

**PHASE 30 RE-VERIFY TOTAL: 52 passed, 0 failed → Phase 30 = PASS** (previous 30-3b failure `0 wired / 30 stubs` is GONE: now `5 mapped / 25 stubs` with the 4 PreToolUse registrations carried.)

---

## 4. PHASE 31 RE-VERIFY

### 4.1 Probe 31-1-RE — 5-branch merge integrity — **PASS**

```
1. 98b07da  (1/5-hygiene)         ancestor of main AND origin/main — main_exit=0 origin_exit=0 parents=2   PASS
2. 3c5e521  (2/5-cleanup)         ancestor of main AND origin/main — main_exit=0 origin_exit=0 parents=2   PASS
3. 978c87c  (3/5-diagnostic)      ancestor of main AND origin/main — main_exit=0 origin_exit=0 parents=2   PASS
4. a7eaad3  (4/5-self-identity)   ancestor of main AND origin/main — main_exit=0 origin_exit=0 parents=2   PASS
5. d4b273f  (5/5-phase-31-wiring) ancestor of main AND origin/main — main_exit=0 origin_exit=0 parents=2   PASS
```

All five are 2-parent merge commits and all are ancestors of main @ `6d65032`. **PROBE 31-1-RE RESULT: PASS**

### 4.2 Probe 31-2-RE — zero-deletion invariant — **PASS**

```
range: 115b1fc7..d4b273f
git diff --diff-filter=D --name-only  → 0 entries                          PASS
git diff --diff-filter=D --name-status -M → 0 entries (rename detection)   PASS
NOTE range stat (last line): 246 files changed, 16012 insertions(+), 518 deletions(-)
```

The `518 deletions(-)` in the summary stat are LINE deletions inside modified/renamed files; the invariant counts FILE deletions (`--diff-filter=D`) = **0**, with and without rename detection. 246 files matches Arena's baseline decomposition (94 A · 19 M · 133 R100). **PROBE 31-2-RE RESULT: PASS**

### 4.3 Probe 31-3-RE — 16.5 scheduler store memory-fallback hydration — **PASS**

Deterministic fallback engaged via the constructor's declared seam (`new JobStore({ memory: true })` — skips `node:sqlite` entirely; independent of runtime Node version):

```
memory fallback engaged (available === false) — available=false                           PASS
getJob returns a hydrated job — id=w31re-16-5                                             PASS
cron SURVIVES hydration — cron="*/5 * * * *"                                              PASS
nextRunAt SURVIVES hydration — nextRunAt=1770000000000                                    PASS
action is an OBJECT (no double-encode) — action={"type":"goal-ledger"}                    PASS
re-save does NOT clobber cron — cron="*/5 * * * *"                                        PASS
re-save does NOT clobber nextRunAt — nextRunAt=1770000000000                              PASS
listJobs shows the job with cron intact — count=1 cron="*/5 * * * *"                      PASS
--- CONTROL: same assertions against the PRE-FIX store (852a035^, extracted to tmp) ---
CONTROL pre-fix: cron LOST on hydration (probe detects the defect) — pre-fix cron=undefined       PASS
CONTROL pre-fix: nextRunAt LOST on hydration — pre-fix nextRunAt=undefined                        PASS
CONTROL pre-fix: action double-encoded (string, not object) — pre-fix action type=string          PASS
CONTROL pre-fix: re-save clobbers cron — pre-fix re-save cron=undefined                           PASS
```

Post-fix clean 8/8; the control proves the probe actually detects the pre-fix defect (cron/nextRunAt lost, action double-encoded). **PROBE 31-3-RE RESULT: PASS**

### 4.4 Probe 31-4-RE — wiring hooks — **PASS**

Harness: `initPhase31Wiring({ sessionId: 'reverify-30-31', runtimeRoot: <probe-dir>/w31-runtime })` — a REAL boot at `6d65032`, honest W36 gate (v24.21.0 ≥ 22.5), all state outside the repo. Per-hook table (39 keys, `id | wired? | evidence line`):

```
W36      | YES | W31 W36: node gate ok (node v24.21.0 >= 22.5)
B1       | YES | W31 B1: brain.repo ready (root ../scripts/verify3031re/w31-runtime/brain)
B2       | YES | W31 B2: brain.index ready (pages=0, backend=rule-based — embedding model NOT VERIFIED)
B3       | YES | W31 B3: brain.search.hybrid -> context source "brain-hybrid" registered
B4       | YES | W31 B4: brain.hot.meta -> context source "brain-hot-memory" registered (+ mcp meta seam)
B5       | YES | W31 B5: brain.protocol verbs -> memory-verb surface ready (recall, remember, entity, synthesize, forget)
WA1      | YES | W31 WA1: prompt assembly -> provider bridge registered (live model call NOT attempted here)
WA8      | YES | W31 WA8: provider config plumbing present (live-LLM leg NOT VERIFIED — no new credentials rule)
WA2      | YES | W31 WA2: semantica graph attached to memory subsystem (graph.query reachable)
WA3      | YES | W31 WA3: instincts observer attached for reverify-30-31 (SessionStart seam)
WA5      | YES | W31 WA5: fleet supervisor ready (dir ../scripts/verify3031re/w31-runtime/fleet)
W10A1    | YES | W31 W10A1: rlm kernel -> CommandRegistry "/rlm" registered
W17      | YES | W31 W17: code source registered (graph-first, raw-read fallback)
W18      | YES | W31 W18: viking filesystem -> context source "viking" registered (tiered reads)
W19      | YES | W31 W19: visual QA attached to Verifier claim path (browser absent -> honest BROWSER_UNAVAILABLE skip)
S3-AUTO  | YES | W31 S3-AUTO: autonomy -> scheduler (cron job w31-autonomy-cycle -> goal-ledger pass on tick)
S3-CYCLE | YES | W31 S3-CYCLE: brain.cycle -> cron job w31-brain-cycle (repo/hot/index bound at boot)
S3-OFFLOAD | YES | W31 S3-OFFLOAD: context/offload -> chat retention (source session-offload-history; offload store reachable)
S3-GSD   | YES | W31 S3-GSD: GSD 5-phase loop -> workgraph seam (handler gsd-loop via swarm/loops/looper.run)
W23e     | YES | W31 W23e: ralph diagnostics -> loop checkpoint (evaluate() via emitCheckpoint; run() untouched)
W23f     | YES | W31 W23f: ciDoctor -> CI failure path (diagnose() seam; live-CI leg NOT VERIFIED — no CI runner in sandbox)
WA4      | YES | W31 WA4: swarm topologies -> workforce dispatch (wa4-topology mounted; default passthrough)
W13      | YES | W31 W13: gatedDispatch -> executor path (audit-only default; default-deny owner call untouched)
W14      | YES | W31 W14: AAS -> mcp registry (aas entry, local stdio; live ping in probe)
W29      | YES | W31 W29: ralph pre-flight checks -> capability doctor (agent-clis, mcp-registry, bundles)
S4-N8N   | YES | W31 S4-N8N: n8n-mcp -> mcp registry (declarative, enabled:false — NOT live-verified)
S4-EXEC  | YES | W31 S4-EXEC: executable skills -> skills catalog (plugin-skill seam, dir skills/executable)
S4-REPOCTX | YES | W31 S4-REPOCTX: semantica/repo-map -> session bootstrap (source repo-map, bounded scan)
W23c     | YES | W31 W23c: forgejo-mcp -> mcp registry (declarative placeholder, enabled:false — live forge leg blocked)
W16      | NO  | W31 W16: Phase 12 gates loop call sites located (CodingLoop.js, VerificationLoop.js) — NOT WIRED, owner call
W10      | YES | W31 W10.1: provider profiles -> registry lock-in (groq-default: llama-4-scout @ GROQ_API_KEY, deepseek-default: deepseek-v4 @ DEEPSEEK_API_KEY; Phase 27 schema valid 2/2; keyRef-only, values never read; keys present 0/2 — live legs NOT VERIFIED) / W31 W10.2: console model indicator wired (keyRef present -> model name; absent -> honest "model unresolved — configure a provider")
P30.A    | YES | W31 P30.A: 30-hook catalog -> session lifecycle runtime (5 wired events mapped, 25 stub handlers registered; SessionStart fired at boot, SessionEnd on shutdown)
P30.B    | YES | W31 P30.B: skill allowedTools -> executor dispatch enforcement (fail-closed when ctx.skill present; plain calls unaffected)
P30.C    | YES | W31 P30.C: subagent contract fields -> dispatch enforcement (allowedTools, maxTurns, permissionMode at call time)
P30.D    | YES | W31 P30.D: path-scoped rules -> prompt assembly (B4-route: context source "path-rules"; section seam unconsumed — DISCLOSED)
P30.E    | YES | W31 P30.E: worktree isolation -> subagent dispatch (isolation:worktree runs in a real worktree; main tree untouched)
P30.F    | YES | W31 P30.F: lifecycle hooks -> approval denial + command expansion + tool batch (fail-soft seams; neutral defaults)
P30.G    | YES | W31 P30.G: self-evolve -> agent runtime post-run (afterRun on declared skill ownership; Phase 14 decisions + PROV-O)
S19      | YES | W31 S19: self -> identity section + guard (JEXI OS v1.6.2, 11 facts from brain/self/core.md, E_SELF_IMMUTABLE armed)
```

Assertions:

```
boot wired map exposes 39 hooks — keys=39                                               PASS
FAIL-SOFT never fired at boot — 0 FAIL-SOFT lines                                       PASS
no E_WIRING surfaced at boot — 0 E_WIRING lines                                         PASS
every non-wired hook is explicitly marked intentional (no silent no-op)
  — not-wired=W16; all marked: W16(intentional)                                         PASS
count: 38 wired + 1 intentional (W16) — wired=38 not-wired=["W16"]                      PASS
P30.A mounts the 30-hook runtime (5 wired / 25 stubs) — no FAIL-SOFT, claim is TRUE     PASS
```

**The pre-fix 31-4 failure is gone**: `P30.A` now mounts cleanly (its own invariant `30/5/25` holds), the previously masked FAIL-SOFT no longer fires, and the only non-wired hook is `W16` — explicitly marked `NOT WIRED, owner call` in its own evidence line. **PROBE 31-4-RE RESULT: PASS (39 hooks: 38 wired + 1 intentional)**

### 4.5 Probe 31-5-RE — adapters + cost cap — **PASS**

```
adapter gaia: run is callable — function             PASS
adapter terminal-bench: run is callable — function   PASS
adapter swebench-pro: run is callable — function     PASS
adapter webarena: run is callable — function         PASS
adapter osworld: run is callable — function          PASS
--- cost cap: cap=1.00 USD ---
charge under cap accepted — {"used":0.6,"cap":1,"remaining":0.4,"currency":"USD"}              PASS
over-cap charge THROWS E_COST_CAP_EXCEEDED — code=E_COST_CAP_EXCEEDED                          PASS
charge REFUSED not clamped (used unchanged) — {"used":0.6,"cap":1,"remaining":0.4,…}           PASS
remaining not silently zeroed/negative — remaining=0.4                                         PASS
charging exactly to cap is allowed (remaining 0) — {"used":0.5,"cap":0.5,"remaining":0,…}      PASS
next positive charge after cap is refused — code=E_COST_CAP_EXCEEDED                           PASS
cost.assert() invariant holds (used <= cap)                                                    PASS
```

**PROBE 31-5-RE RESULT: PASS (12/12)**

### 4.6 Probe 31-6-RE — unified result envelope — **PASS**

Front door `meta.run({ benchmark, adapter, runner, manifest, costCap, clock, tracePath })` with the real gaia fixture (`benchmarks/_fixtures/gaia/mini-validation.json`, 6 tasks), deterministic stub runner, injected clock:

```
gaia fixture yields task ids — tasks=6                                                   PASS
manifest carries model version / dataset rev / seed —
  model={"name":"verify-stub","version":"1.0.0"} datasetRev=gaia-mini-validation@sha:fixture seed=42   PASS
manifest sha256 is 64-hex — e6db49745ec5d960…                                            PASS
envelope exposes the unified shape — keys=[adapterVersion, benchmark, costCap, costUsed,
  manifestRef, perTask, ranAt, rate, resolved, total]                                    PASS
envelope.manifestRef == manifest sha256 (64 hex) — e6db49745ec5d9606443fe62c3eb6b9127ffe9e29f4093548d37dcdd8ec4c189   PASS
manifest itself carries MODEL VERSION — {"name":"verify-stub","version":"1.0.0"}         PASS
manifest carries DATASET REV — gaia-mini-validation@sha:fixture                          PASS
manifest carries SEED — 42                                                               PASS
all tasks resolved under the cap — total=6 resolved=6 rate=1                             PASS
per-task rows carry the completeness quadruple —
  {"taskId":"task-1","pass":true,"tokens":12,"durationMs":3,"costUsd":0.01,"status":"EVALUATED"}        PASS
trace sink written: ONE canonical doc with one record per completed task — records=6 adapter=gaia       PASS
trace doc carries adapter + runId derived from the manifest sha256 — runId=gaia-e6db49745ec5d960        PASS
DETERMINISM: byte-identical envelope across two runs — bytes=833                         PASS
run WITHOUT a manifest is refused (E_NO_MANIFEST) — code=E_NO_MANIFEST                   PASS
```

**PROBE 31-6-RE RESULT: PASS (14/14)**

### 4.7 Probe 31-7-RE — independent negative check + boot journal — **PASS**

ONE composite test that fails when wiring is broken (this exact assertion set detected the pre-fix breakage):

```
(a)  catalog reports the ADVERTISED 5 wired / 25 stubs — count=30 mapped=5 stubs=25      PASS
(a2) PreToolUse is a MAPPED event with its 4 shipped registrations —
     stub=false handlers=["pre.dev-server-blocker","pre.tmux-reminder",
                          "pre.git-push-reminder","pre.pre-commit-quality"]              PASS
(b)  journal invariants: 40 lines, 0 FAIL-SOFT, 0 E_WIRING —
     lines=40 FAIL-SOFT=0 E_WIRING=0                                                    PASS
CONTROL: this check detects a broken journal (injected FAIL-SOFT line detected)         PASS
```

The boot journal itself, verbatim (40 lines, numbered):

```
01 W31 W36: node gate ok (node v24.21.0 >= 22.5)
02 W31 B1: brain.repo ready (root ../scripts/verify3031re/w31-runtime/brain)
03 W31 B2: brain.index ready (pages=0, backend=rule-based — embedding model NOT VERIFIED)
04 W31 B3: brain.search.hybrid -> context source "brain-hybrid" registered
05 W31 B4: brain.hot.meta -> context source "brain-hot-memory" registered (+ mcp meta seam)
06 W31 B5: brain.protocol verbs -> memory-verb surface ready (recall, remember, entity, synthesize, forget)
07 W31 WA1: prompt assembly -> provider bridge registered (live model call NOT attempted here)
08 W31 WA8: provider config plumbing present (live-LLM leg NOT VERIFIED — no new credentials rule)
09 W31 W10.1: provider profiles -> registry lock-in (groq-default: llama-4-scout @ GROQ_API_KEY, deepseek-default: deepseek-v4 @ DEEPSEEK_API_KEY; Phase 27 schema valid 2/2; keyRef-only, values never read; keys present 0/2 — live legs NOT VERIFIED)
10 W31 W10.2: console model indicator wired (keyRef present -> model name; absent -> honest "model unresolved — configure a provider")
11 W31 WA2: semantica graph attached to memory subsystem (graph.query reachable)
12 W31 WA3: instincts observer attached for reverify-30-31 (SessionStart seam)
13 W31 WA5: fleet supervisor ready (dir ../scripts/verify3031re/w31-runtime/fleet)
14 W31 W10A1: rlm kernel -> CommandRegistry "/rlm" registered
15 W31 W17: code source registered (graph-first, raw-read fallback)
16 W31 W18: viking filesystem -> context source "viking" registered (tiered reads)
17 W31 W19: visual QA attached to Verifier claim path (browser absent -> honest BROWSER_UNAVAILABLE skip)
18 W31 S3-AUTO: autonomy -> scheduler (cron job w31-autonomy-cycle -> goal-ledger pass on tick)
19 W31 S3-CYCLE: brain.cycle -> cron job w31-brain-cycle (repo/hot/index bound at boot)
20 W31 S3-OFFLOAD: context/offload -> chat retention (source session-offload-history; offload store reachable)
21 W31 S3-GSD: GSD 5-phase loop -> workgraph seam (handler gsd-loop via swarm/loops/looper.run)
22 W31 W23e: ralph diagnostics -> loop checkpoint (evaluate() via emitCheckpoint; run() untouched)
23 W31 W23f: ciDoctor -> CI failure path (diagnose() seam; live-CI leg NOT VERIFIED — no CI runner in sandbox)
24 W31 WA4: swarm topologies -> workforce dispatch (wa4-topology mounted; default passthrough)
25 W31 W13: gatedDispatch -> executor path (audit-only default; default-deny owner call untouched)
26 W31 W14: AAS -> mcp registry (aas entry, local stdio; live ping in probe)
27 W31 W29: ralph pre-flight checks -> capability doctor (agent-clis, mcp-registry, bundles)
28 W31 S4-N8N: n8n-mcp -> mcp registry (declarative, enabled:false — NOT live-verified)
29 W31 S4-EXEC: executable skills -> skills catalog (plugin-skill seam, dir skills/executable)
30 W31 S4-REPOCTX: semantica/repo-map -> session bootstrap (source repo-map, bounded scan)
31 W31 W23c: forgejo-mcp -> mcp registry (declarative placeholder, enabled:false — live forge leg blocked)
32 W31 W16: Phase 12 gates loop call sites located (CodingLoop.js, VerificationLoop.js) — NOT WIRED, owner call
33 W31 P30.A: 30-hook catalog -> session lifecycle runtime (5 wired events mapped, 25 stub handlers registered; SessionStart fired at boot, SessionEnd on shutdown)
34 W31 P30.B: skill allowedTools -> executor dispatch enforcement (fail-closed when ctx.skill present; plain calls unaffected)
35 W31 P30.C: subagent contract fields -> dispatch enforcement (allowedTools, maxTurns, permissionMode at call time)
36 W31 P30.D: path-scoped rules -> prompt assembly (B4-route: context source "path-rules"; section seam unconsumed — DISCLOSED)
37 W31 P30.E: worktree isolation -> subagent dispatch (isolation:worktree runs in a real worktree; main tree untouched)
38 W31 P30.F: lifecycle hooks -> approval denial + command expansion + tool batch (fail-soft seams; neutral defaults)
39 W31 P30.G: self-evolve -> agent runtime post-run (afterRun on declared skill ownership; Phase 14 decisions + PROV-O)
40 W31 S19: self -> identity section + guard (JEXI OS v1.6.2, 11 facts from brain/self/core.md, E_SELF_IMMUTABLE armed)
```

**Exactly 40 lines, 0 `FAIL-SOFT`, 0 `E_WIRING`** — as asserted. The pre-fix 31-7 failure is gone: every negative assertion that previously turned red now holds, and the control proves the check still fires on broken input. **PROBE 31-7-RE RESULT: PASS**

**PHASE 31 RE-VERIFY TOTAL: 55 passed, 0 failed → Phase 31 = PASS**

---

## 5. NEW SWEEP — F7 CLASS CHECK (`new URL(spec, import.meta.url)`)

Independent sweep over all git-tracked `.js/.mjs/.cjs` files: every LITERAL `new URL(<spec>, import.meta.url)` is resolved against the importing file's directory and existence-checked on disk.

```
files_scanned=1834
spec_count=37
resolved_ok=36
broken_count=1
non_literal_new_URL_sites=64  (dynamic specs — not statically resolvable; informational only)
```

The one unresolved target:

```
BROKEN:
  runtime/context/viking/filesystem.js:66 spec="../../../data/viking" -> <repo>/data/viking MISSING
```

**Analysis (lazy materialization, not a dead reference).** This is the default root that Arena's fix RESTORED (pre-fix it pointed to `<repo>/runtime/data/viking` — finding F4). The module header documents the default as `<repo>/data/viking`, and the constructor creates it on first use before any read:

```
LAZY-MATERIALIZATION PROOF (sandbox mirror, repo untouched):
  VikingFs() with no root, mirrored layout -> default root created on construct: true
  (constructor: fs.mkdirSync(this.root, { recursive: true }) — filesystem.js:66-67)
  => the single "missing" target is the documented default data root,
     created on first use; data/ carries 0 tracked files by design (git ls-files data/ → 0).
```

Classification: **false positive of the static existence check** — the spec resolves to the CORRECT documented path; the target is a runtime-created data root, not a restructure residual. Per the strict letter of the assert ("every resolved target exists") the sweep verdict is:

**F7 SWEEP VERDICT: FAIL by the strict assert (36/37 exist) — 1 unresolved target, analyzed as lazily-materialized default data root; no dead reference found. Ruling left to the lead.**

For completeness: the other 36 specs include the fix's own edits (registry → `infra/hooks/hooks.json`, 3 command modules → `../../runtime/scheduler/autonomous/index.js`, viking, and the 8 repaired probe scripts) — all resolve.

---

## 6. CHECKSUMS (independently computed)

```
4907241239ab359ca31800b083bf7c4393997646c47bd0257ec408ca3c15399b  harness/parity/hooks/registry.js          (post-fix; Arena's pre-fix value a0dc3cd8… no longer applies)
7c45a039f13defe933da085f16d300fd8dcdd84b871a21289a70304193bc33bf  infra/hooks/hooks.json
68d566d217678ee874604bee3df967c07b5070ac7731d58083b8c2ca01f0905e  harness/parity/hooks/catalog.js
cbc3b71ae3f60a5302a36f0bfef612636c934249ae9444bdd09ff9856933fc3c  server/src/wiring/phase31-bootstrap.js   (unchanged by the fix — matches Arena's baseline)
a0dc3cd8b43f569ec3dad967788ce74712a8df9c26b50791fa9d098cda74106f  server/src/wiring/phase31-hooks.js       (unchanged by the fix — matches Arena's baseline)
3b8cd346852dadf4774eff55b713f8e2b2d2083d94fc931d492c9ab56c265117  server/src/scheduler/queue/store.js      (16.5 fix intact — matches Arena's baseline)
81024b74a7d042d2e8a030a63574290fbc817910b6963b22f333735193eda589  benchmarks/_meta/cost.js
2fb854325d14eeee321975d8583a4273ae47e1cdaa3a7d956ff9fcebb375d6d6  benchmarks/_meta/index.js
1a5b6b15837e3efd47ac62a1df8ada98f1cfe724d152d85ceef55bd0fd30070e  runtime/context/viking/filesystem.js     (post-fix)
62237e8aadc567a77e4d682cbc658065ae4eef0273df2849ae52863e8f415fc6  capabilities/commands/goal.command.js    (post-fix; autonomous/heartbeat analogous)
```

---

## 7. FINDINGS (anything observed, even where probes passed)

- **F-RE-1 (the fix is real and load-bearing).** `bfdeb95` changed exactly what the cross-verify failures required: `harness/parity/hooks/registry.js:7` now points at `infra/hooks/hooks.json` (F2 root cause), the three command modules import `../../runtime/scheduler/autonomous/index.js` (F3), viking's default root is restored to the documented `<repo>/data/viking` (F4), the Scope-0 wiring-plan ledger path is fixed (F1), and the two stale probe scripts were repaired (F5). Both previously failed probes (30-3b; 31-4 + 31-7) now pass with the failures' exact root causes observably gone.
- **F-RE-2 (F7 strict miss — lazy data root).** See §5. The sweep's one unresolved target is the VikingFs default data root, created on first construction. No action required for the restructure-residual class; if the lead wants the static sweep green, the options are (a) accept the documented false-positive class, or (b) have the harness owner ship a `<repo>/data/.gitkeep`-style placeholder. NOT DONE HERE (READ-ONLY).
- **F-RE-3 (cosmetic float artifact).** `envelope.costUsed` accumulated as `0.060000000000000005` (0.01 × 6 IEEE-754 drift). Determinism is unaffected (byte-identical across runs — the artifact is deterministic), and Arena's run displayed `0.06`. Cosmetic; flagging for the benchmarks owner.
- **F-RE-4 (probe-count hygiene note).** 64 `new URL(` call sites use a NON-literal first argument (variables/interpolations) and cannot be resolved statically by any sweep of this class. They are listed (locations only) in the sweep output, not counted as specs. This is the same blind spot F7 originally documented; a runtime-instrumented sweep (proxying `URL` during a full test boot) would be the next tightening step.
- **F-RE-5 (evidence hygiene).** The 31-4 boot ran with the honest W36 gate (v24.21.0 ≥ 22.5) and real `node:sqlite` — strictly MORE load-bearing than Arena's version-shimmed boot. The 16.5 probe additionally covers the sqlite path being available: the memory-fallback assertions were driven deterministically via the declared `{ memory: true }` seam rather than by the runtime lacking `node:sqlite`.
- **F-RE-6 (no repo mutations).** `git status --porcelain` was empty immediately before the commit; every runtime artifact (brain, fleet, instincts, viking, offload, sessions, gsd, worktrees, self-evolve, rules, trace sinks, pre-fix control copies) lives under the probe directory or `os.tmpdir()`.

---

## 8. NOT VERIFIED

1. **Non-GAIA adapters were not executed end-to-end** — terminal-bench, swebench-pro, webarena, osworld: module load + callable `run` only (same scope as Arena's 31-5A). No fixture runs for them; no credentials rule.
2. **Live legs**: WA8 live LLM, W23f live CI, S4-N8N / W23c live MCP, W14 AAS live ping, live provider keys (journal reports `keys present 0/2`) — not attempted, standing no-new-credentials rule.
3. **The full server test chain** — not in scope for this re-verify; the known environmental failures (test-hud, test-everything, 5× AGI node:sqlite-class) were not re-run and not re-classified here.
4. **"Wiring hooks (0)–(17)" as a literal enumeration** — no such literal registry exists in the repo; verified the 39-key boot `wired` map instead (see §2 interpretation note). If the lead meant a different 0–17 set, this probe must be re-issued.
5. **CI status of the branch push** — GitHub CI state for `verification/phase-30-31-reverify` was not queried.
6. **`data/viking` materialization on the real tree** — deliberately NOT exercised (would write into the repo); proven on a sandbox mirror instead (§5).

---

## 9. DO-NOT LIST COMPLIANCE

| Rule | Status |
|---|---|
| Regenerate every probe; no reuse of previous probe files | ✅ new suite written from spec under `scripts/verify3031re/` (outside the repo); no prior probe file executed |
| Do NOT reuse Arena's re-implementations | ✅ Arena's probes were only READ as context (their report); no probe code reused; builder/fixed probe scripts never executed as evidence |
| READ-ONLY — no code edits, no fixes | ✅ repo content diff vs `origin/main` = this document only (§ P9) |
| No merges, no deletions, no branch rewrites | ✅ none issued; branch + tag preserved |
| One commit — the report document only | ✅ single commit containing only `docs/VERIFY-PHASE-30-31-REVERIFY.md` |
| No new credentials | ✅ none created/stored; installs restored lockfile-pinned trees only |

## P9 — ZERO-TOUCH PROOF

```
git diff --stat origin/main..HEAD
 docs/VERIFY-PHASE-30-31-REVERIFY.md | 549 +   ← the ONLY changed path
 1 file changed
git status --porcelain  (pre-commit) → empty
```

## P10 — ZONE CHECK

Writes confined to `docs/VERIFY-PHASE-30-31-REVERIFY.md` (zone) + push of the pre-created branch/tag. No other path added, modified, or deleted. Section A artifacts (`verification/phase-28-30`, `docs/VERIFY-PHASE-28-30.md`) untouched.

---

## FINAL VERDICTS

| Item | Verdict |
|---|---|
| **Phase 30** | **PASS** — 52/52 (30-3b-RE, 30-3-full-RE, 30-1-RE, 30-2-RE, 30-4-RE, 30-5-RE all PASS) |
| **Phase 31** | **PASS** — 55/55 (31-1…31-7-RE all PASS; boot journal 40 lines / 0 FAIL-SOFT / 0 E_WIRING; 38 wired + 1 intentional) |
| **F7 sweep** | **FAIL by strict assert** (36/37) — single miss analyzed as lazily-created default data root, not a dead reference; ruling to the lead |

With Phase 30 = PASS and Phase 31 = PASS, **Phase 30 and Phase 31 may be CLOSED** per the verification rule (a PASS requires every named probe green — achieved). The F7 strict miss is reported separately for the lead's ruling and does not gate either phase per the probe list above.


