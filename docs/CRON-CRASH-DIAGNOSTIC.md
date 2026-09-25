# Scope-3 probe cron crash — diagnostic (report only)

Phase 31 diagnostic, branch `diagnostic/cron-crash` (from `phase-31-wiring` tip `da6f565c`).
No fix applied. No shipped module edited. All runs below were executed on REST-RECONSTRUCTED
worktrees (Git transport unavailable in the sandbox; every reconstructed `write-tree` matched the
remote tree SHA). Lockfile deps only (`npm ci --ignore-scripts`), no new dependencies.

## Verdict

**PRE-EXISTING — reproduces at ec4aca06.** Not a regression from Scopes 5–16. It is an
**environment-dependent latent bug** in the shipped Phase 6 scheduler store (`333d44ff`,
2026-09-15): the in-memory fallback of `JobStore` (taken when `node:sqlite` is unavailable)
loses the job's `cron` spec after the first re-save, so `SchedulerEngine.tick()` calls
`nextCronDate(null)` → `TypeError: Cannot read properties of null (reading 'month')`.
Scope 3 was accepted 22/22 on **Node v24.21.0** (docs/SERVER-REQUIREMENTS.md), where
`node:sqlite` loads unflagged and the SQLite path is used. On Node **22.x < 22.13**
`node:sqlite` needs `--experimental-sqlite`; without it the store silently degrades to memory
mode and the probe crashes. Same commit, same files, different runtime → "used to pass".

## P1 — Step 0 refs (REST, raw)

```
phase-31-wiring tip: da6f565c2e51922a9c92dadf9efaeefeb0532db3   (7433a0b0 in the brief has since advanced by 15/16)
created refs/heads/diagnostic/cron-crash   da6f565c2e51922a9c92dadf9efaeefeb0532db3
created refs/tags/pre-diagnostic-cron-crash da6f565c2e51922a9c92dadf9efaeefeb0532db3
verify GET heads/diagnostic/cron-crash      da6f565c2e51922a9c92dadf9efaeefeb0532db3
verify GET tags/pre-diagnostic-cron-crash   da6f565c2e51922a9c92dadf9efaeefeb0532db3
compare ec4aca06...da6f565c: files touching scheduler/ or cron or scope-3-probe = []   (none)
```

## P2 — Run A: ec4aca06 (Scope 3 tip), Node v22.12.0, default flags

```
[PASS] P2.probe-init — probe boot: 15 Scope-1 lines + 7 Scope-3 lines, 0 FAIL-SOFT
[PASS] P1.server-up — GET /api/health -> 200
[PASS] P1.all-7-targets — 7/7 Scope 3 boot lines, 15/15 Scope 1 lines intact, 0 FAIL-SOFT
[PASS] P2.S3-OFFLOAD.source-registered / chat-path-reachable / store-roundtrip
[PASS] P2.S3-GSD.five-phase-loop · P2.W23e.checkpoint-fired · P2.W23f.simulated-reachable · P2.W23f.honest-empty-path
[PASS] P2.WA4.build-validate · P2.WA4.default-passthrough
[PASS] P2.S3-CYCLE.run-now — engine.runNow(w31-brain-cycle) -> run run-mudqud5t-0001
[FAIL] P2.S3-CYCLE.cron-invoked-cycle — brain.cycle ran through the scheduler cron job (trigger=manual, action=handler brain-cycle, 0 phase records)
TypeError: Cannot read properties of null (reading 'month')
    at nextCronDate (file:///…/wA/server/src/scheduler/triggers/cron.js:93:17)
    at SchedulerEngine.tick (file:///…/wA/server/src/scheduler/index.js:101:27)
    at file:///…/wA/scripts/phase31-scope-3-probe.mjs:207:32
exit 1
```
Boot log line 16 (same run): `[scheduler] node:sqlite unavailable — persistent queue disabled (in-memory only)`

## P3 — Run B: da6f565c (current tip), Node v22.12.0, default flags

```
[PASS] P2.S3-CYCLE.run-now — engine.runNow(w31-brain-cycle) -> run run-mudqyale-0001
[FAIL] P2.S3-CYCLE.cron-invoked-cycle — … 0 phase records
TypeError: Cannot read properties of null (reading 'month')
    at nextCronDate (file:///…/wB/server/src/scheduler/triggers/cron.js:93:17)
    at SchedulerEngine.tick (file:///…/wB/server/src/scheduler/index.js:101:27)
    at file:///…/wB/scripts/phase31-scope-3-probe.mjs:207:32
exit 1
```
Identical crash. (Earlier sighting during Scope 19 on 0ea456d0: same trace.)

## P4 — Run C (bisect): NOT NEEDED

A crashes ⇒ not a regression. Additionally the four files involved are byte-identical between
ec4aca06 and da6f565c (blob SHAs):
```
server/src/scheduler/queue/store.js     0572b905  ==  0572b905
server/src/scheduler/triggers/cron.js   89cc817d  ==  89cc817d
server/src/scheduler/index.js           6ba5ecc8  ==  6ba5ecc8
scripts/phase31-scope-3-probe.mjs       bf8bcea7  ==  bf8bcea7
```

## P5 — Crash detail

**Expression with (null month):** there is no malformed string. `job.cron` itself is **`null`**
for job `w31-brain-cycle` at the time of the tick. `parseCron(null)` is never reached because
`nextCronDate` only parses when `typeof expr === 'string'`; with `null` it proceeds with
`parsed = null` and dereferences `parsed.month` at cron.js:93.

**Registration source:** `server/src/wiring/phase31-bootstrap.js` S3-CYCLE (Scope 3),
`createJob({ id: 'w31-brain-cycle', kind: 'cron', cron: '0 3 * * *', lane: 'memory', … })`.
The expression is valid at creation (`createJob` runs `parseCron` first and succeeds).

**Mechanism (memory-fallback store only):**
1. `JobStore.saveJob(job)` builds a *row* with `spec: JSON.stringify({cron,…})` and, when
   `!this.available`, stores that **row** in `_mem.jobs` (store.js:94-112).
2. `JobStore.getJob(id)` in memory mode returns the **raw row un-hydrated**
   (`return this._mem.jobs.get(id)`, store.js:126) — the row has `spec` (string) but **no
   `cron` property**, whereas `listJobs()` hydrates (`...safeParse(row.spec)`) (store.js:132-134).
3. After the probe's `runNow('w31-brain-cycle')` completes, the engine does
   `fresh = this.store.getJob(job.id); fresh.runCount++; this.store.saveJob(fresh)`
   (index.js ≈225-230). `specOf(fresh)` reads `fresh.cron ?? null` → **`null`** and overwrites
   the stored spec with `{"cron":null,…}`.
4. Next `tick()` → `listJobs()` hydrates `cron: null`; `nextRunAt` is `null` (the job was
   created with `nextCronDate` → 03:00 but the same raw-row re-save also dropped it) → the
   `else if (!job.nextRunAt)` branch calls `nextCronDate(null, now)` → TypeError.

Instrumented run (preload outside the repo, hooking `listJobs`) at the moment of the crash:
```
[DIAG] store=…/server/data/scheduler.db available=false job={"id":"w31-brain-cycle","kind":"cron","cron":null,"cronType":"object","enabled":true,"nextRunAt":null,"name":"w31 brain dream cycle"}
```
Probe's own output earlier in the same run already shows the damage:
`cron job at boot: {"id":"w31-brain-cycle",…,"cron":null,…,"action":"{\"type\":\"handler\",…}"}` —
note `action` is a JSON *string* there too (double-encoded), same raw-row symptom.

**Isolated repros (Node v22.12.0):**
```
$ node --input-type=module -e "import {nextCronDate} from './server/src/scheduler/triggers/cron.js';
  console.log(nextCronDate('0 3 * * *', new Date('2026-09-23T00:00:00Z'))); nextCronDate(null, new Date());"
2026-09-23T03:00:00.000Z
TypeError: Cannot read properties of null (reading 'month')

$ node --input-type=module -e "import {JobStore} from './server/src/scheduler/queue/store.js';
  const s=new JobStore({memory:true}); s.saveJob({id:'w31-brain-cycle',kind:'cron',cron:'0 3 * * *',enabled:true,action:{}});
  console.log(1, s.listJobs()[0].cron); const raw=s.getJob('w31-brain-cycle'); console.log(2, raw.cron, raw.spec);
  raw.runCount=1; s.saveJob(raw); console.log(3, s.listJobs()[0].cron);"
1 0 3 * * *
2 undefined {"cron":"0 3 * * *","event":null,"condition":null,"intervalSeconds":null}
3 null

$ node --experimental-sqlite --input-type=module -e "… new JobStore({file:':memory:'}) … same sequence …"
sqlite store available= true getJob.cron = "0 3 * * *"          (SQLite path hydrates getJob → no corruption)
```

**Control run — A again with node:sqlite enabled (`NODE_OPTIONS=--experimental-sqlite`, ec4aca06):**
```
[PASS] P2.S3-CYCLE.cron-invoked-cycle — … 13 phase records
[PASS] P2.S3-AUTO.tick-fired — autonomy cycle fired on a real scheduler cron tick … heartbeat leg pinged 2x
(no TypeError; remaining FAILs are the probe's own zone/ralph checks against a reconstructed tree — unrelated)
```

**git blame (REST `/commits?path=`; reconstructed worktrees have synthetic history):**
```
server/src/scheduler/queue/store.js     333d44ff 2026-09-15 openhands  phase-6(B): scheduler — cron/event/condition triggers, persistent queue, concurrency
server/src/scheduler/triggers/cron.js   333d44ff 2026-09-15 openhands  (same commit; only commit ever touching these files)
server/src/scheduler/index.js           333d44ff 2026-09-15 openhands  (same)
```
Offending lines: `store.js:126` (`getJob` returns un-hydrated row in memory mode) and
`store.js:209` (`specOf` → `job.cron ?? null`) — both Phase 6(B). `cron.js:93` is only the
crash site; `index.js:101` the caller.

**Why acceptance saw 22/22:** docs/SERVER-REQUIREMENTS.md: "Phase 31 verification was
performed on Node v24.21.0". On v24 `require('node:sqlite')` succeeds unflagged → SQLite path.
On the sandbox's v22.12.0 it throws `ERR_UNKNOWN_BUILTIN_MODULE` without `--experimental-sqlite`
→ memory fallback → crash. CI (`.github/workflows/ci.yml`) now pins `node-version: 24`
(bumped from 22 by cleanup v2, 2026-09 — see docs/CONSOLIDATED-CLEANUP-v2-2026-09.md), so CI
always ships node:sqlite unflagged. (Historical: while CI pinned 22, it resolved to
whatever 22.x was current — 22.13+ ships node:sqlite unflagged; older 22.x does not.)

## P6 — Verdict

**PRE-EXISTING — reproduces at ec4aca06.** Runtime-conditional (memory-fallback store, Node
without unflagged `node:sqlite`). Not a flake: deterministic across 3 runs on two SHAs.
No fix applied.

## P7 — Zone

`git status --short` before commit: `?? docs/CRON-CRASH-DIAGNOSTIC.md` only.
