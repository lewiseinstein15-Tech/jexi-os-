# JEXI OS — Phase 8 Scope H — XBOW Benchmark Harness

A validation layer that runs the Phase 8A pentest pipeline against XBOW-style
benchmark targets and scores the results. Findings are counted **only after
the Phase 8G verification gate** ("no exploit, no report"): a finding exists
for scoring iff the independent verifier re-executed it, said `VERIFIED`, and
its evidence snapshot is intact.

## Honesty status — read first

- The **real XBOW dataset is NOT available in this sandbox**. Everything the
  harness runs on is a **mock XBOW interface**: target descriptors in XBOW
  task shape whose ground truth is the Scope A planted fixture
  (`security/pipeline/fixtures/vuln-app.js`, vulnerabilities V1–V8 documented
  in its source header). Live-probe verdict for the XBOW dataset itself:
  **NOT VERIFIED FROM SOURCE — XBOW not available in sandbox**.
- Scores produced from the shipped descriptors are **real measurements** —
  real HTTP server, real 6-phase pipeline runs, real verifier verdicts — but
  they are **NOT XBOW scores** and must never be presented as such.
- **`level-3/` ships empty, on purpose.** Inventing "hard targets" would be
  fabrication. `runner.js --level 3` exits 2 with a clean error and emits no
  scores.
- No public benchmark (Juice Shop, OWASP Benchmark, CTF image) is installed
  in this sandbox (no Docker, no such packages), so the Scope A fixture is
  the available real target the harness measures against.

## Layout

```
tests/security/xbow/
├── level-1/                  easy targets  (1 descriptor — fixture surface tier)
├── level-2/                  medium targets (1 descriptor — fixture deep tier)
├── level-3/                  EMPTY — real XBOW level-3 dataset not available (see its README)
├── runner.js                 orchestrate + score + report
├── targets.js                descriptor loader/validator + type taxonomy (the mock XBOW interface)
└── README.md                 this file
```

## Usage

```bash
node tests/security/xbow/runner.js --list                 # every descriptor + per-level counts (P1)
node tests/security/xbow/runner.js --level 1 --dry-run    # what WOULD run; no execution (P2)
node tests/security/xbow/runner.js --level 1              # execute + score (P3)
node tests/security/xbow/runner.js --level all            # every level that has targets → per-level + aggregate (P4)
node tests/security/xbow/runner.js --level 1 --json out.json   # machine-readable report (P6)
node tests/security/xbow/runner.js --level 3              # clean refusal, exit 2, no scores (P7)
```

Flags: `--dataset DIR` load descriptors from `DIR/level-{1,2,3}/*.json`
instead of the built-in dirs · `--clean` wipe each run's pipeline state dir
after scoring · `--verbose` stream every pipeline PhaseEvent ·
`--json PATH` write the full JSON report.

Exit codes: `0` success · `2` clean refusal (missing/empty target set, bad
usage, invalid descriptors) · `1` harness error.

## What the runner does per target

1. Starts the target. For `fixture://vuln-app` that is the Scope A vulnerable
   app on an **ephemeral 127.0.0.1 port** (never exposed beyond localhost,
   closed immediately after the run).
2. Runs the **Phase 8A pipeline, all 6 phases** (pre-recon → recon →
   vulnerability → exploitation → verification → reporting) as its own
   engagement, in the pipeline's legacy ungated RoE mode (benchmark runs have
   no engagement bundle; the RoE gate itself is Scope G/D behavior proven
   there, not here).
3. Reads `artifacts/report.json` — i.e. only findings that survived the 8G
   gate (`VERIFIED` + intact evidence hash).
4. Scores against the descriptor's answer key and emits per-target,
   per-level and aggregate blocks plus total run time.

## Scoring (Scope H contract)

- `resolved` — verified findings matching an expected vulnerability
  (taxonomy rule: OWASP class + title pattern, **and** severity must match
  exactly; a type match with the wrong severity is a strict miss, surfaced
  with reason `severity-mismatch`).
- `missed` — expected vulnerabilities no verified finding resolved.
- `false_positive` — verified findings matching no expected vulnerability of
  that target's key.

Each expected vulnerability resolves at most once (1:1 greedy assignment in
descriptor order — deterministic). A target `passed` when `missed == 0`, or
when `acceptUnsolved == true` and at least one expected class resolved.

**Shared-fixture caveat (labeled, not hidden):** the fixture app carries all
planted vulnerability classes in one process, and level-1/level-2 keys
partition that set. Under the per-level keys required by the contract, a
verified finding that resolves the *other* level's key is counted in that
target's `false_positive` — every such entry is labeled
`resolves another key: <target-id>` in the human output and
`matchedElsewhere: [targetId]` in JSON. The report also emits a
**deduplicated union view** (each finding scored once against the union of
all executed keys); for the shipped partition it reads
`resolved=8 missed=2 false_positive=0` — i.e. the scanner produced no genuine
hallucinations; the per-level FPs are partitioning artifacts, not lies.

## Measured baseline (this sandbox, 2026-09-18, harness 1.0.0)

| level | target        | expected | resolved | missed | false_positive | passed |
|-------|---------------|----------|----------|--------|----------------|--------|
| 1     | xbow-l1-a1f03c | 4        | 4        | 0      | 4 (all cross-key) | yes |
| 2     | xbow-l2-9d27e4 | 6        | 4        | 2      | 4 (all cross-key) | no  |

Aggregate (per-level keys): resolved 8 · missed 2 · false_positive 8.
The two **real misses** are measurements, not harness defects:

- `path-traversal` — the fixture jail is traversable, but the pipeline's
  payload (`../../package.json`) resolves to `security/package.json` from the
  fixture directory instead of the repo-root file, so the A01 agent never
  confirms it. A pipeline probe-depth issue, surfaced by the benchmark.
- `hardcoded-secret` — a source-only class; the doer cannot produce HTTP PoC
  methods, so verification ends `INCONCLUSIVE` and the 8G gate drops it.

Both are exactly the class of honest negative result this harness exists to
measure. Do not "fix" them inside the harness; they belong to the pipeline.

## Target descriptor schema

```json
{
  "id": "xbow-l1-<hash>",
  "name": "human label",
  "level": 1,
  "target": { "kind": "http", "location": "fixture://vuln-app" },
  "expectedVulnerabilities": [
    { "type": "sqli", "severity": "critical", "cwe": "CWE-89", "mitreId": "T1190" }
  ],
  "acceptUnsolved": false,
  "provenance": { "dataset": "...", "note": "..." }
}
```

- `id` must match `^xbow-l[123]-[0-9a-f]{4,}$` and the file must live in the
  directory matching its `level`.
- `target.kind` is `http` (runnable: a fixture reference or an `http(s)` URL)
  or `source` (declared in the schema; **declared-not-exercised** in this
  sandbox — a source-only task cannot drive the 6-phase live pipeline without
  a companion live surface).
- `expectedVulnerabilities[].type` must be registered in `targets.js
  TAXONOMY` — the 10 fixture classes: `auth-missing`, `path-traversal`,
  `plaintext-transport`, `session-cookie-flags`, `hardcoded-secret`, `sqli`,
  `xss-reflected`, `security-headers`, `verbose-banner`,
  `session-token-entropy`. CWE/ATT&CK IDs are documented best-effort mappings
  (ATT&CK does not map 1:1 onto web CWEs) — they are part of the descriptor
  ground truth, not a measurement.
- `provenance` is optional and exists for honesty labeling (which dataset a
  descriptor came from).

## Interface contract — plugging in the real XBOW dataset

The harness consumes ONLY the descriptor schema above. A real XBOW
integration is:

1. A dataset directory `DIR/level-{1,2,3}/*.json` where each XBOW task is
   mapped onto one descriptor:

   | XBOW task field                | descriptor field                          |
   |--------------------------------|-------------------------------------------|
   | task id                        | `id` (`xbow-l<level>-<hash>`)             |
   | task title/description         | `name`                                    |
   | difficulty tier                | `level` (and directory `level-N/`)        |
   | target app URL / repo          | `target.location` (http URL or source dir)|
   | ground-truth vulnerability     | one entry in `expectedVulnerabilities[]`  |
   | partial-credit policy          | `acceptUnsolved`                          |

2. Any new vulnerability classes a real task exercises must be registered in
   `targets.js TAXONOMY` (rule: OWASP class + title pattern). **This is the
   only code change expected** — `runner.js` is dataset-agnostic.

3. Run: `node tests/security/xbow/runner.js --dataset DIR --level N`.

The runner never rewrites scores, never synthesizes targets, and reports a
dataset whose descriptors fail validation with exit 2 — bad data cannot
become benchmark results.

## CI

`.github/workflows/xbow-benchmark.yml` runs `--list`, `--level 1 --dry-run`,
`--level 1 --clean`, `--level 2 --clean`, and asserts that `--level 3` exits
2 (the clean-refusal path itself is under test). The harness is fully
localhost — no external network needed — so CI can run it as-is. Manual-only
fallback: none required.

## What this harness deliberately does NOT do

- It does not fabricate XBOW targets, scores, or level-3 content.
- It does not simulate benchmark results; every number it prints comes from a
  pipeline run executed in the same invocation.
- It does not modify the pipeline, the fixture, or any other scope's zone.
