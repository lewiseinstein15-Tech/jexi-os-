# VERIFY — PHASE 31 (WIRING + BENCHMARK PREP) — CROSS-VERIFICATION

- **Section**: B (Arena verifies Phase 31; builder = GLM) — builder ≠ verifier ✅
- **Branch**: `verification/phase-31` · **Tag**: `pre-verify-31` · **Zone**: this document only
- **Date**: 2026-09-24
- **VERDICT: FAIL** — 5 of 7 probes PASS; 31-4 FAIL, 31-7 (negative check) DETECTED BREAKAGE.
  Per the shared rule ("Do NOT round up. A partial pass is a FAIL with a findings list."), Phase 31 is **NOT closed**.

---

## 1. BASE SHA + REFS

```
git fetch origin
git checkout main
git pull origin main
HEAD        = 6737419bed71e18901953db051fa6cfc5e2c666b
origin/main = 6737419bed71e18901953db051fa6cfc5e2c666b   (expected 6737419 ✅ — main has NOT moved)
origin/restructure/file-structure = 4521f49 (preserved, merged)
pre-verify-28-30 (GLM's tag) = 6737419  (Section A started, same base)
pre-verify-31 (mine)         = 6737419
branch verification/phase-31 = 6737419 (off main, clean)
```

**Sandbox re-provisioning (disclosed).** Between the previous turn and this one the workspace was
restored from a file snapshot that drops `.git` and credential files. The object store and the stored
PAT were gone. Restoration was **read-only w.r.t. the repo**:

```
git init · git remote add origin https://github.com/lewiseinstein15-Tech/jexi-os-.git
git fetch origin '+refs/heads/*:refs/remotes/origin/*' '+refs/tags/*:refs/tags/*' --tags   (repo is publicly readable)
git update-ref refs/heads/main refs/remotes/origin/main · git symbolic-ref HEAD refs/heads/main · git reset -q
```
`git reset -q` updates the index only — no working-tree write. Proof the committed state is intact:
`origin/main^{tree}` = `HEAD^{tree}` = `b2d805b8cbbab29d82cbb5d5178db5b68660b4a4` (the tree verified at 4521f49).

**Environment drift found in the restored worktree (NOT repo defects, NOT touched — read-only):**
18 files with mode-only changes (`100755 → 100644`: lost exec bits) and one deleted symlink
`server/public → ../dist` (mode 120000, content `../dist`; last touched by 1a626e0). Both are
snapshot-restore artifacts; content hash of every tracked file is unchanged.

**Dependency bring-up (disclosed).** `node_modules/` (excluded from snapshots) was absent, so the
repo's own pinned trees were restored: `npm ci` at root and `npm --prefix server ci`. No manifest
changed (`git diff -- package.json package-lock.json server/package.json server/package-lock.json` = empty);
no new dependency was added.

**Unresolved ref operations:** `git push origin verification/phase-31` and the tag push need credentials —
```
fatal: could not read Username for 'https://github.com': No such device or address
```
The PAT is requested from the lead (blocker, §5).

---

## 2. METHOD SUMMARY — how the probes were regenerated

- Every probe below was **written by me from the spec** and lives under `/tmp/probes/`
  (`p31-3.mjs`, `p31-4.mjs`, `p31-4b.mjs`, `p31-4c.mjs`, `p31-5.mjs`, `p31-6b.mjs`, `p31-7.mjs`).
  **No builder probe file was reused** (`scripts/phase31-scope-*.mjs`, `scripts/phase31-0-wiring-plan.mjs`
  were not executed as verification evidence).
- Probes run against a **read-only checkout**; the boot probes were pointed at a runtime root outside the
  repo (`/tmp/w31-*`) so no state was written into the tree.
- Where a probe could be self-validated, a **control** was used: probe 31-3 was run against both the
  post-fix module and the pre-fix module extracted from git (`852a035^`), proving the test detects the defect.
- `node --check`-level syntax of each probe is implicit (they ran); the ambient runtime is `v20.20.2`.

**Interpretation note (spec ambiguity, recorded honestly).** The prompt describes "Wiring hooks (0)–(17)".
The repository contains **no literal 0…17 hook registry**; Phase 31's numbering is *scopes* `0,1,…,17`
(+ `16.5`, `19`), and the wiring surface itself is the boot seam's `wired` map. Probe 31-4 therefore
verifies the **authoritative wiring surface** — the 39 keys returned by `initPhase31Wiring().wired`,
each with its boot evidence line — and §3.1 lists the scope artifacts for cross-reference. If the lead
meant a different 0–17 enumeration, this part must be re-issued; it is flagged rather than assumed.

---

## 3. PHASE 31

### 3.1 Files + SHAs + tags found

**The 5 merges (Probe 31-1 subjects)** — all present, all two-parent merge commits:

| SHA | message | parents |
|---|---|---|
| `98b07da` | merge: phase-31 hygiene — archive 99 historical artifacts to docs/archive/{fixlog,reports} | 2 |
| `3c5e521` | merge: phase-31 2/5 cleanup/root-files — move root-level files to docs/ | 2 |
| `978c87c` | merge: phase-31 3/5 diagnostic/cron-crash — scope-3 cron-crash diagnostic probe | 2 |
| `a7eaad3` | merge: phase-31 4/5 self/identity — JEXI self/identity module (phase-31(19)) | 2 |
| `d4b273f` | merge: phase-31 5/5 phase-31-wiring — wiring + 16.5 fix | 2 |

**Phase-31 sub-commits**: `7be66e7` (19), `6c89edb` (15), `da6f565` (16), `852a035` (16.5), `216825a` (17).

**Tags**: `post-merge-2`, `post-merge-3`, `post-merge-4`, `post-merge-5`, `pre-phase-31-final`, `pre-phase-31-wiring`.

**Wiring source** (`server/src/wiring/`, 10 files): `phase31-bootstrap.js` (45 189 B — the boot seam,
`initPhase31Wiring`, `assertNodeFloor`, `NODE_FLOOR='22.5'`, 39-key `wired` map), `phase31-hooks.js`
(P30.A/P30.F consumer), `phase31-cidoctor.js`, `phase31-providers.js`, `phase31-registries.js`,
`phase31-repoctx.js`, `phase31-self-evolve.js`, `phase31-subagent.js`, `phase31-wa4-topology.js`,
`phase31-worktree.js`.

**16.5 fix**: `server/src/scheduler/queue/store.js` (commit `852a035`, +96 probe lines; store +17/−6).

**Benchmarks** (`benchmarks/`, 5 adapter dirs + `_fixtures/` + `_meta/`): `gaia/`, `terminal-bench/`,
`swebench-pro/`, `webarena/`, `osworld/`; `_meta/{cost,index,manifest,result,trace}.js`;
`_fixtures/{gaia,osworld,swebench-pro,terminal-bench,webarena}/…`.

**Scope artifacts** (`scripts/`): `phase31-0-wiring-plan.mjs`, `phase31-scope-{1,2,3,5,6,7,8,9,10,11,12,13,14,15,16,16.5,17,19}-probe.mjs`,
`phase31-scope-4-execute.mjs`.

---

### 3.2 PROBES — raw output + verdict (7/7 ran)

#### Probe 31-1 — 5-branch merge integrity — **PASS**

```
1. 98b07da  1/5-hygiene            ancestor_of_origin/main? exit=0  ✅ PASS
2. 3c5e521  2/5-cleanup            ancestor_of_origin/main? exit=0  ✅ PASS
3. 978c87c  3/5-diagnostic         ancestor_of_origin/main? exit=0  ✅ PASS
4. a7eaad3  4/5-self-identity      ancestor_of_origin/main? exit=0  ✅ PASS
5. d4b273f  5/5-phase-31-wiring    ancestor_of_origin/main? exit=0  ✅ PASS
PROBE 31-1 RESULT: PASS (all 5 exit 0)
```
Supplementary: all five are 2-parent merge commits (`parents=2` each).

#### Probe 31-2 — zero-deletion invariant — **PASS**

```
range: 115b1fc7..d4b273f
D (deletions) : 0
raw diff names:  94 A · 19 M · 133 R100
with rename detection (-M): D count = 0
PROBE 31-2 RESULT: PASS (0 deletions)
```

#### Probe 31-3 — 16.5 scheduler store memory-fallback hydration — **PASS**

Fixture: empty store → construct → `available===false` (memory fallback engaged) → save job with
`cron='*/5 * * * *'`, `nextRunAt=1770000000000`, `action={type:'goal-ledger'}` → read → re-save → re-read.
Control: the same assertions against the pre-fix module (`852a035^`).

```
--- POST-FIX (main@6737419): store.js ---
  [scheduler] node:sqlite unavailable — persistent queue disabled (in-memory only)
  memory fallback engaged (available===false): true
  ✅ memory fallback engaged on empty store
  ✅ getJob returns a hydrated job
  ✅ cron SURVIVES hydration — cron="*/5 * * * *"
  ✅ nextRunAt SURVIVES hydration — nextRunAt=1770000000000
  ✅ action is an object (no double-encode) — action={"type":"goal-ledger"}
  ✅ re-save does NOT clobber cron to null — cron="*/5 * * * *"
  ✅ re-save does NOT clobber nextRunAt to null — nextRunAt=1770000000000
  ✅ listJobs shows the job with cron intact — cron="*/5 * * * *"
===== CONTROL (expect FAILURES) =====
  ✅ PRE-FIX: memory fallback engaged on empty store
  ✅ PRE-FIX: getJob returns a hydrated job
  ❌ PRE-FIX: cron SURVIVES hydration — cron=undefined
  ❌ PRE-FIX: nextRunAt SURVIVES hydration — nextRunAt=undefined
  ❌ PRE-FIX: action is an object (no double-encode) — action="{\"type\":\"goal-ledger\"}"
  ❌ PRE-FIX: re-save does NOT clobber cron to null — cron=undefined
  ❌ PRE-FIX: re-save does NOT clobber nextRunAt to null — nextRunAt=undefined
  ❌ PRE-FIX: listJobs shows the job with cron intact — cron=null
PROBE 31-3 RESULT: post-fix 8 passed/0 failed · pre-fix 2 passed/6 failed
VERDICT: PASS (post-fix clean + control detects defect: true)
```
The fix is real and load-bearing: without it the memory-fallback path loses `cron`, `nextRunAt` and
double-encodes `action`.

#### Probe 31-4 — wiring hooks — **FAIL**

Harness: `initPhase31Wiring({ sessionId:'verify-31', runtimeRoot:'/tmp/w31-runtime', … })`, boot journal
captured (`/tmp/probes/p31-4.out.json`). Room: ambient `v20.20.2`; the W36 hard gate refuses < 22.5, so
the harness reported a floor-passing version string **for this probe only** (disclosed; the gate itself was
verified separately — see supplementary below). `node:sqlite`: UNAVAILABLE in this runtime.

Rule applied after the first run (self-correction, disclosed): **a hook whose `soft()` threw (a
`FAIL-SOFT` entry in the journal) is NOT counted as wired**, even though the `wired` map can say `true` —
the map is assigned inside the throwing block, so it can advertise success after its own invariant failed.

Result: **37/39 wired**, 2 not wired → `W16`, `P30.A`.

```
W16         | NO  | W31 W16: Phase 12 gates loop call sites located (CodingLoop.js, VerificationLoop.js) — NOT WIRED, owner call
P30.A       | NO  | W31 P30.A: FAIL-SOFT E_WIRING catalog 30/wired 0/stubs 30 mismatch
---
W16: 2 intentional-marker line(s)   → explicitly marked "NOT WIRED, owner call"  ✅ intentional
P30.A: 0 intentional-marker line(s) [FAIL-SOFT — its own check threw]             ❌ NOT marked intentional
wired 37/39; all NO hooks explicitly marked intentional: false
VERDICT: FAIL
```
Direct catalog probe (`p31-4b.mjs`):
```
count()  : 30
mapped() : 0 -> (none)
stubs()  : 30
initPhase31Hooks counts(): {"catalog":30,"wired":0,"stubs":30}
wiredEvents(): (none)
```
The boot log nevertheless prints, immediately after the FAIL-SOFT:
`W31 P30.A: 30-hook catalog -> session lifecycle runtime (5 wired events mapped, 25 stub handlers registered; …)`.
**The advertised claim is false on main** (0 mapped / 30 stubs) and `wired['P30.A']=true`. Root cause = Finding **F2**.

#### Probe 31-5 — benchmark adapters exist + callable; cost cap refuses — **PASS**

```
✅ gaia            — run is function
✅ terminal-bench  — run is function
✅ swebench-pro    — run is function
✅ webarena        — run is function
✅ osworld         — run is function
--- cost cap: cap=1.00 USD, charge(0.6) then charge(0.6) [would take used to 1.20] ---
✅ over-cap charge THROWS — code=E_COST_CAP_EXCEEDED
✅ error code is E_COST_CAP_EXCEEDED
✅ REFUSED, not clamped: used unchanged — used 0.6 -> 0.6
✅ remaining not silently zeroed/negative — remaining=0.4
✅ charge exactly to cap allowed (remaining 0) — {"used":0.5,"cap":0.5,"remaining":0,"currency":"USD"}
PROBE 31-5 RESULT: PASS (10 passed, 0 failed)
```

#### Probe 31-6 — unified result envelope (Scope 16) — **PASS**

Run through the documented front door `meta.run({ benchmark, adapter, runner, manifest, costCap, clock })`
with a **real adapter** (gaia over `benchmarks/_fixtures/gaia/mini-validation.json`, deterministic stub
pipeline) and an instrumented runner supplying `tokens/durationMs/costUsd`.

```
meta.run keys: unifiedResult, manifest, tracePath
envelope keys: benchmark, adapterVersion, ranAt, total, resolved, rate, perTask, manifestRef, costUsed, costCap
manifestRef   : "a1bf4d8c7ff91bc3a2383a0d95fce36d164fe13702db2dbfbd1879169907c92f"
aggregate     : total=6 resolved=6 rate=1 costUsed=0.06 costCap=1
✅ run returns the manifest carrying MODEL VERSION — model={"name":"verify-stub","version":"1.0.0"}
✅ run returns the manifest carrying DATASET REV — datasetRev=gaia-mini-validation@sha:fixture
✅ run returns the manifest carrying SEED — seed=42
✅ envelope.manifestRef is the sha256 of that manifest (64 hex)
✅ per-task rows carry the completeness quadruple — {"taskId":"…0001","pass":true,"tokens":12,"durationMs":3,"costUsd":0.01,"status":"EVALUATED"}
✅ all instrumentation rows evaluated (status EVALUATED)
✅ costUsed accumulates the runner charges (6 x 0.01)
✅ trace sink written — tracePath=/tmp/probes/p31-6-trace.jsonl
✅ trace record carries runId + adapter + manifest sha256 — {"adapter":"gaia","runId":"gaia-a1bf4d8c7ff91bc3",…}
✅ DETERMINISM: same inputs + clock => byte-identical envelope
PROBE 31-6 RESULT: PASS (11 passed, 0 failed)
```
Also verified negative-path: `meta.result` without a manifest is REFUSED (`E_NO_MANIFEST`), and rows
missing instrumentation are REFUSED (`E_INCOMPLETE_TASK`, observed during probe authoring).

*Probe-authoring note (transparency):* my first 31-6 assertion expected the pins under
`env.manifestRef.manifest`; the contract returns `manifestRef` as the sha256 **reference** and the
manifest itself alongside the envelope (`→ { unifiedResult, manifest, tracePath }`). The probe was
corrected to the documented contract — no product defect was involved.

#### Probe 31-7 — independent negative check — **FAIL (detected breakage)**

One test asserting the boot's *own* invariants (not a happy path):

```
❌ (a) catalog reports the ADVERTISED 5 wired / 25 stubs — actual: mapped=0 stubs=30
❌ (a2) PreToolUse is a MAPPED event (it has 4 shipped Phase 7 registrations) — mapped=[none]
✅ (b) every false hook is explicitly marked "NOT WIRED" in source — false=["W16"] intentional=["W16"]
❌ (c) boot journal contains no E_WIRING FAIL-SOFT — masked failure: W31 P30.A: FAIL-SOFT E_WIRING catalog 30/wired 0/stubs 30 mismatch
PROBE 31-7 RESULT: FAIL (1 passed, 3 failed)
negative check DETECTED BREAKAGE — Phase 31 wiring is NOT fully intact
```
The negative check behaved as specified: it fails when wiring is broken, and it is broken (F2).

#### Supplementary (beyond the 7 named probes)

- **W36 floor gate behaves correctly ambiently**: boot on `v20.20.2` →
  `✅ refused on v20.20.2 -> W36 NODE FLOOR: JEXI server requires Node >= 22.5 (node:sqlite memory backend); running v20.20.2. Refusing to boot.`
- **Fix-direction proof for F2** (patched *copy* under `/tmp/p31fix`, repo untouched):
  `../../../hooks/hooks.json` → `../../../infra/hooks/hooks.json` yields
  `count=30 · mapped=5 [PreToolUse, Stop, PreCompact, SessionStart, SessionEnd] · stubs=25`,
  handler counts `PreToolUse:4 Stop:1 PreCompact:1 SessionStart:1 SessionEnd:1` — i.e. exactly the
  advertised "5 wired / 25 stubs".
- **`new URL(spec, import.meta.url)` repo-wide sweep** (37 such specs in 1 918 files): **7 unresolved**
  → F2, F3, F4, F5 (below).

---

### 3.3 WIRING HOOK TABLE (39 keys, `initPhase31Wiring().wired`)

| id | wired? | evidence line (boot journal) |
|---|---|---|
| W36 | YES | `W31 W36: node gate ok (node v22.6.0 >= 22.5)` |
| B1 | YES | `W31 B1: brain.repo ready (root …/brain)` |
| B2 | YES | `W31 B2: brain.index ready (pages=0, backend=rule-based — embedding model NOT VERIFIED)` |
| B3 | YES | `W31 B3: brain.search.hybrid -> context source "brain-hybrid" registered` |
| B4 | YES | `W31 B4: brain.hot.meta -> context source "brain-hot-memory" registered (+ mcp meta seam)` |
| B5 | YES | `W31 B5: brain.protocol verbs -> memory-verb surface ready (recall, remember, entity, synthesize, forget)` |
| WA1 | YES | `W31 WA1: prompt assembly -> provider bridge registered (live model call NOT attempted here)` |
| WA8 | YES | `W31 WA8: provider config plumbing present (live-LLM leg NOT VERIFIED — no new credentials rule)` |
| WA2 | YES | `W31 WA2: semantica graph attached to memory subsystem (graph.query reachable)` |
| WA3 | YES | `W31 WA3: instincts observer attached for verify-31 (SessionStart seam)` |
| WA5 | YES | `W31 WA5: fleet supervisor ready (dir …/fleet)` |
| W10A1 | YES | `W31 W10A1: rlm kernel -> CommandRegistry "/rlm" registered` |
| W17 | YES | `W31 W17: code source registered (graph-first, raw-read fallback)` |
| W18 | YES | `W31 W18: viking filesystem -> context source "viking" registered (tiered reads)` |
| W19 | YES | `W31 W19: visual QA attached to Verifier claim path (browser absent -> honest BROWSER_UNAVAILABLE skip)` |
| S3-AUTO | YES | `W31 S3-AUTO: autonomy -> scheduler (cron job w31-autonomy-cycle -> goal-ledger pass on tick)` |
| S3-CYCLE | YES | `W31 S3-CYCLE: brain.cycle -> cron job w31-brain-cycle (repo/hot/index bound at boot)` |
| S3-OFFLOAD | YES | `W31 S3-OFFLOAD: context/offload -> chat retention (source session-offload-history; offload store reachable)` |
| S3-GSD | YES | `W31 S3-GSD: GSD 5-phase loop -> workgraph seam (handler gsd-loop via swarm/loops/looper.run)` |
| W23e | YES | `W31 W23e: ralph diagnostics -> loop checkpoint (evaluate() via emitCheckpoint; run() untouched)` |
| W23f | YES | `W31 W23f: ciDoctor -> CI failure path (diagnose() seam; live-CI leg NOT VERIFIED — no CI runner in sandbox)` |
| WA4 | YES | `W31 WA4: swarm topologies -> workforce dispatch (wa4-topology mounted; default passthrough)` |
| W13 | YES | `W31 W13: gatedDispatch -> executor path (audit-only default; default-deny owner call untouched)` |
| W14 | YES | `W31 W14: AAS -> mcp registry (aas entry, local stdio; live ping in probe)` |
| W29 | YES | `W31 W29: ralph pre-flight checks -> capability doctor (agent-clis, mcp-registry, bundles)` |
| S4-N8N | YES | `W31 S4-N8N: n8n-mcp -> mcp registry (declarative, enabled:false — NOT live-verified)` |
| S4-EXEC | YES | `W31 S4-EXEC: executable skills -> skills catalog (plugin-skill seam, dir skills/executable)` |
| S4-REPOCTX | YES | `W31 S4-REPOCTX: semantica/repo-map -> session bootstrap (source repo-map, bounded scan)` |
| W23c | YES | `W31 W23c: forgejo-mcp -> mcp registry (declarative placeholder, enabled:false — live forge leg blocked)` |
| **W16** | **NO — intentional** | `W31 W16: Phase 12 gates loop call sites located (CodingLoop.js, VerificationLoop.js) — NOT WIRED, owner call` (2 marker lines in source) |
| W10 | YES | map `true` (`W31 W10.1/.2` lines: provider profiles + console model indicator) |
| P30.B | YES | `W31 P30.B: skill allowedTools -> executor dispatch enforcement (fail-closed when ctx.skill present; plain calls unaffected)` |
| P30.C | YES | `W31 P30.C: subagent contract fields -> dispatch enforcement (allowedTools, maxTurns, permissionMode at call time)` |
| P30.D | YES | `W31 P30.D: path-scoped rules -> prompt assembly (B4-route: context source "path-rules"; section seam unconsumed — DISCLOSED)` |
| P30.E | YES | `W31 P30.E: worktree isolation -> subagent dispatch (isolation:worktree runs in a real worktree; main tree untouched)` |
| P30.F | YES | `W31 P30.F: lifecycle hooks -> approval denial + command expansion + tool batch (fail-soft seams; neutral defaults)` |
| P30.G | YES | `W31 P30.G: self-evolve -> agent runtime post-run (afterRun on declared skill ownership; Phase 14 decisions + PROV-O)` |
| S19 | YES | `W31 S19: self -> identity section + guard (JEXI OS v1.6.2, 11 facts from brain/self/core.md, E_SELF_IMMUTABLE armed)` |
| **P30.A** | **NO — real** | `W31 P30.A: FAIL-SOFT E_WIRING catalog 30/wired 0/stubs 30 mismatch` — **not** marked intentional (F2) |

**Counts**: wired **37/39**; not wired **2** = `W16` (intentional, disclosed in source) + `P30.A`
(**defective** — its own invariant check throws, the failure is masked, and the catalog is a 30/30 no-op).
**Assertion "no hook is a silent no-op unless explicitly marked intentional": VIOLATED.**

---

### 3.4 CHECKSUMS (independently computed; no repo "verification" file trusted)

Wiring — `server/src/wiring/`:
```
cbc3b71ae3f60a5302a36f0bfef612636c934249ae9444bdd09ff9856933fc3c  phase31-bootstrap.js
1d3efaf986c9180002294998143ef24913cbedff9367dfac5f22e7e1645f7857  phase31-cidoctor.js
a0dc3cd8b43f569ec3dad967788ce74712a8df9c26b50791fa9d098cda74106f  phase31-hooks.js
9eef90b42ccc3618e03001afc15e331bc35fd6afa05f6fac4a6c27f838665d77  phase31-providers.js
72c07206a84b873b079295dc099176b5512a2c0d3e8843ffffd996a642cd6228  phase31-registries.js
6b56716b7bad8cdebb83d5705cf0f416ea836c370c16697cca5051d295026da8  phase31-repoctx.js
c1d7204ef15bd159ab366f04c8ab943afdac9a0af461dbc5e22ce78b18fb1315  phase31-self-evolve.js
848f3013eef1b4bdb885d074bc622692ff2edc8ab0ac18ac75b78c414ec4ddc6  phase31-subagent.js
b75d2e91b843a8a35c41fe9e22226866946c6de50ca38774e3dfe541e307395b  phase31-wa4-topology.js
244b039933b25348e058bb0d2648a0ce334a229e237306055c7b2996a4cbc05e  phase31-worktree.js
```
16.5 scheduler fix:
```
3b8cd346852dadf4774eff55b713f8e2b2d2083d94fc931d492c9ab56c265117  server/src/scheduler/queue/store.js
65c7aa643f46a6c3bc722eb423fc8a8bf8656268b3588f91145bc490859e27fb  server/src/scheduler/queue/fairness.js
10645951ddc58f100ecaeb5094f4cbb1787d8e434cf9ac5832b425c04f1c700f  server/src/scheduler/queue/priority.js
```
Benchmark layer:
```
81024b74a7d042d2e8a030a63574290fbc817910b6963b22f333735193eda589  benchmarks/_meta/cost.js
2fb854325d14eeee321975d8583a4273ae47e1cdaa3a7d956ff9fcebb375d6d6  benchmarks/_meta/index.js
f8e3460de3ad9cb0d6979691014957b681e71da23165cd9885937f89de4ddf6a  benchmarks/_meta/manifest.js
cb797c92c80b918a43192f2aa2a45c4bff4ab12fdb96a05f815d1476e0fbb61c  benchmarks/_meta/result.js
62b125cf5b88a8b32f9e6caa52e0c10d0e43cc2b86b0712126b8dc6245e2ab93  benchmarks/_meta/trace.js
b028ae28ba686817a1794df8b5217ed989eb4de2b23308004d61cc48331a49d0  benchmarks/gaia/index.js
c63e53ccccfb6ade463d75658f4a79b328df4436b3aea0df6d6301e80d3753f5  benchmarks/terminal-bench/index.js
34be30591ecb22fc9eaf1ea59de273dfce092f155a7629c6570bc9d83f1496d9  benchmarks/swebench-pro/index.js
beb70240bfad710ed3d290de454f7986a7ce2cad53f2a773b40e96fef05caf5d  benchmarks/webarena/index.js
bfdbc161403f09cb1acadd9837fa7d2f7227510c6ba3fc0a60a276eb7e19202a  benchmarks/osworld/index.js
```
Phase-31 scripts (20 files; probe artifacts) — full list:
```
8cd8cb35a30f4e44d7e3b58208fe7395916e2f59649e1cf1e33b6ce87a59dbd9  scripts/phase31-0-wiring-plan.mjs
71c6f3a6de8237267998f934db158fa502b0472dbe84736fec879b42d938b056  scripts/phase31-scope-1-probe.mjs
b37b3b2e49a6958e5a79aa57768e144a8957a967d90c41196e98435ef5588231  scripts/phase31-scope-16-probe.mjs
cf54703842e429d19e363055fab3bdad2e22db77336e9c244df5bd22701854fc  scripts/phase31-scope-16.5-probe.mjs
1760ac1f90e39dab69305b0d3525c32a6f10f782b448176e5a570f177a7a881b  scripts/phase31-scope-17-probe.mjs
e4829b02da4f8e17a560b4e87b276d18e5ef477be6a1bbbfda153df49c81f819  scripts/phase31-scope-19-probe.mjs
(remaining scope probes 2,3,5,6,7,8,9,10,11,12,13,14,15 + scope-4-execute hashed in the run log)
```

### 3.5 VERDICT — **FAIL**

| Probe | Spec | Result |
|---|---|---|
| 31-1 | 5-branch merge integrity | **PASS** |
| 31-2 | zero-deletion invariant | **PASS** |
| 31-3 | 16.5 store memory-fallback hydration | **PASS** (control proves detection) |
| 31-4 | wiring hooks: no silent no-op unless intentional | **FAIL** (P30.A defective no-op, masked) |
| 31-5 | 5 adapters callable + cost cap refuses | **PASS** |
| 31-6 | unified result envelope | **PASS** |
| 31-7 | independent negative check | **FAIL** — detected breakage |

Phase 31 is **NOT closed**. The 16.5 fix, the benchmark layer and 37 of 39 wiring hooks verify clean;
the failure is concentrated in the Phase 30-hook mapping that Phase 31 scope 6 consumes (§4 F2), plus the
Scope-0 artifact (F1) and three product-code `new URL()` refs from the restructure (F3–F4).

---

## 4. FINDINGS (anything wrong, even where probes passed)

**F1 — `scripts/phase31-0-wiring-plan.mjs` is broken on main (Scope-0 artifact).**
`line 20: const LEDGER = path.join(ROOT, 'ZONE-OWNER.md')` → `ENOENT: …/jexi-os/ZONE-OWNER.md`.
`ZONE-OWNER.md` moved to `docs/operations/ZONE-OWNER.md` in the restructure (Stage 2). The ref was valid
pre-restructure (file present at root in `e6bde65`) → **restructure residual**, not pre-existing rot.
Impact: the wiring-plan coverage proof cannot run on main. Raw: `Error: ENOENT … readFileSync … phase31-0-wiring-plan.mjs:21:14`.

**F2 — the Phase-30 hook mapping is lost on main, and the boot masks the failure.** *(root cause of 31-4 + 31-7)*
`harness/parity/hooks/registry.js:7`:
`const PHASE7_REGISTRY_URL = new URL('../../../hooks/hooks.json', import.meta.url);` → resolves to
`<repo>/hooks/hooks.json` (gone; now `infra/hooks/hooks.json`). The module is **byte-identical to
`e6bde65`**, where that path existed → **restructure residual**.
Consequence chain: `readPhase7Registrations()` fails → `registrations: []` → `buildRegistry()` marks all
30 events `stub:true` → catalog `mapped 0 / stubs 30` → `initPhase31Hooks()` returns `{30,0,30}` → the
bootstrap's own invariant `wired!==5 || stubs!==25` throws `E_WIRING` → `soft()` logs
`W31 P30.A: FAIL-SOFT E_WIRING …` → **but `state.hooks` was already assigned, so the very next line logs
the success claim** `… (5 wired events mapped, 25 stub handlers registered …)` and `wired['P30.A']=true`.
Every hook the catalog maps (PreToolUse with its **4** shipped Phase 7 registrations, Stop, PreCompact,
SessionStart, SessionEnd — 8 registrations total in `infra/hooks/hooks.json`) is currently a no-op on main.
Fix direction proven on a patched copy: `../../../infra/hooks/hooks.json` → `mapped()=5, stubs()=25`.

**F3 — three slash commands silently degrade (product code, restructure residual).**
`capabilities/commands/{autonomous,goal,heartbeat}.command.js:8`:
`await import(new URL('../scheduler/autonomous/index.js', import.meta.url))` → resolves to
`capabilities/scheduler/autonomous/index.js` (absent) → `ERR_MODULE_NOT_FOUND` → caught → `return null`.
Pre-restructure this resolved to `<root>/scheduler/autonomous/index.js` **which existed at `e6bde65`**;
the module now lives at `runtime/scheduler/autonomous/index.js` **and exists** → the correct spec is
`../../runtime/scheduler/autonomous/index.js`. Verified live: the dynamic import fails today.
Impact: `/goal`, `/autonomous`, `/heartbeat` lose their runtime on a dev checkout — silently (by the
files' own documented degrade path).

**F4 — viking filesystem default root silently relocated.** `runtime/context/viking/filesystem.js:66`:
`new URL('../../data/viking', import.meta.url)` previously `<repo>/data/viking` (the documented default),
now `<repo>/runtime/data/viking`; the constructor `mkdirSync`s it, so it fails silently and simply creates
a different tree. `data/` is unversioned (0 tracked files at `e6bde65`) → no ENOENT, which is why every
sweep missed it. Behaviour change, not a crash.

**F5 — two probe scripts carry pre-restructure `new URL` refs**:
`scripts/phase28-ambient-probe.mjs` (`../brain/ambient/reflex/policy.md` → now `mind/brain/…`) and
`scripts/phase30-rules-probe.mjs` (`../prompt/sections/08-instructions.js` → now `capabilities/prompts/…`).

**F6 — Phase 31's own scope probes cannot be re-run as shipped**: 19 unresolved pre-restructure path
expectations across 6 scope probes (e.g. `shippedTrees = ['brain','semantica','mind/instincts','session/fleet','rlm',…]`
in `phase31-scope-1-probe.mjs:183`; `ui/web/console/...` in scope-2; `semantica/repo-map/…` in scope-5;
`brain/cycle/index.js`, `context/offload/index.js` in scope-3). These are the builders' expectations, not
product code — but it means Phase 31 is not independently re-verifiable with its own artifacts.

**F7 — class-level gap (why all of the above survived the restructure + its own sweeps):** the
`new URL(spec, import.meta.url)` form was never handled. Repo-wide sweep: 37 such specs / 1 918 files →
7 unresolved (F2, F3 ×3 files, F4, F5 ×2). 3B-2b's engine contains no URL-spec handling and 3B-3 reused
it, so the class fell through both sweeps; `f6`-style literal lists inside builder scripts mask it further.

**F8 — disclosure-quality notes (not defects):** `P30.D` boots with "section seam unconsumed — DISCLOSED";
`S4-N8N`/`W23c` are declarative `enabled:false`; `W23f`/`WA8` live legs are declared NOT VERIFIED by the
builder. All are honest and consistent with what I measured.

**F9 — environment (sandbox, NOT repo):** `.git` + credentials dropped on re-provision; `node_modules`
absent (restored from lockfile); `server/public` symlink + 18 exec bits missing in the restored worktree;
ambient Node `v20.20.2` below the declared floor `>= 22.5`.

---

## 5. NOT VERIFIED

1. **Phase 31 on its declared runtime (Node ≥ 22.5).** Ambient runtime is v20.20.2 and `node:sqlite` is
   absent; the boot was exercised with a disclosed version shim. Anything sqlite-backed
   (persistent scheduler queue, memory backend, the 5 failing AGI suites, `test-everything`) is outside
   what I could observe — the same environmental class as the known 193/7/200 suite failures.
2. **Adapters other than GAIA were not executed end-to-end** — terminal-bench, swebench-pro, webarena,
   osworld were verified for module load + callable entry point only (31-5 part A). No fixture run for them.
3. **Live legs** (WA8 live LLM, W23f live CI, S4-N8N / W23c live MCP, W14 AAS live ping, scope 17
   live-path readiness): not attempted — no new credentials rule.
4. **The builders' scope probes were not executed** (rule: do not reuse builder probes) — and F6 shows
   several cannot run correctly anyway.
5. **"Wiring hooks (0)–(17)"**: the repo has no literal 0–17 hook registry; I verified the 39-key boot
   `wired` map + the scope artifacts. If the lead meant a different enumeration, this probe must be re-issued.
6. **Refs could not be pushed** (branch + tag + this report) — no stored credential in this session (§1).

---

## 6. DO-NOT LIST COMPLIANCE

| Rule | Status |
|---|---|
| READ-ONLY — no code edits | ✅ repo content diff vs `origin/main`: **0** (the only content delta is the pre-existing `server/public` symlink loss from snapshot restore; 18 mode-only entries likewise pre-existing) |
| No merges, no branch rewriting, no force-push | ✅ none issued |
| One commit — the report document only | ✅ (single commit, this file) |
| No new credentials | ✅ none created/stored; PAT absence is reported as a blocker instead |
| No new dependencies | ✅ no manifest changed; `npm ci` restored the repo's **own** lockfile-pinned trees only (disclosed §1) |
| No touching the other section's branch or doc | ✅ `verification/phase-28-30` / `docs/VERIFY-PHASE-28-30.md` untouched (only observed GLM's `pre-verify-28-30` tag) |
| Zone = exactly `docs/VERIFY-PHASE-31.md` | ✅ |
| STOP after report | ✅ |

**Verdict: FAIL** — report to lead; Phase 31 stays open. F1–F3 are restructure residuals the lead may want
folded into a follow-up stage (F2 is the one that silently disables Phase 30's hook mapping on main).
