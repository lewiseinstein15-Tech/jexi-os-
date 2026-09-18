# JEXI OS — Phase 8 Scope A: Pentest Pipeline

Shannon-pattern security pipeline (six phases since Phase 8G). One phase per
Shannon stage plus an independent verification gate, every phase produces
real artifacts, and the run is durable — it survives `kill -9` at any instant.

```
security/pipeline/
├── index.js                    facade + CLI (run | resume)
├── probe.js                    re-runnable live probe (run | run-then-die | resume)
├── orchestration/
│   ├── durable-workflow.js     Temporal-equivalent driver (skip/resume semantics)
│   └── checkpoint.js           durable state I/O — atomic writes, append-only events
├── phases/
│   ├── pre-recon.phase.js      1/6  source analysis → hypotheses
│   ├── recon.phase.js          2/6  live crawl → app map (pages, forms, headers)
│   ├── vulnerability.phase.js  3/6  5 parallel OWASP agents (A01 A02 A03 A05 A07)
│   ├── exploitation.phase.js   4/6  PoC validation (the DOER'S claims); ≥2 methods for critical/high
│   ├── verification.phase.js   5/6  independent re-execution — VERIFIED / REJECTED / INVALIDATED (Phase 8G)
│   └── reporting.phase.js      6/6  "no exploit, no report" deliverable
└── fixtures/vuln-app.js        deliberately vulnerable LOCAL target (127.0.0.1 only)
```

The verification phase (Phase 8G) is the independent gate between
exploitation and reporting: the exploit agent's EXPLOITED claim is never
trusted — the verifier re-executes with its own methods and markers, demands
≥2 independent observations for CRITICAL/HIGH, commits an immutable evidence
snapshot to the knowledge graph, and refuses to verify its own doer
(`verifier ≠ doer`) or anything outside the engagement RoE. Post-verification
tampering invalidates the evidence hash. See `verification/verifiers/README.md`.

## Phase contract

```js
{
  id: 'pre-recon',
  inputs:  ['source.root'],
  outputs: ['artifacts/pre-recon.json'],
  run(ctx)                  → AsyncIterable<PhaseEvent>,
  resume(checkpointId, ctx) → AsyncIterable<PhaseEvent>,
}
// PhaseEvent: { type: log|progress|finding|artifact|error, phaseId, ts, data }
```

## Durability

State lives only on disk under `.state/<engagementId>/`:

- `checkpoints/<seq>-<phaseId>.json` — written `running` *before* work starts,
  flipped `complete` only after the artifact is durable
- `events.jsonl` — append-only event log
- `artifacts/` — phase deliverables; `run.json` — terminal state

A killed process is recovered by `resume`:

- completed phases are **skipped** (artifact reused)
- the interrupted phase re-enters via `resume()`; per-item progress recorded in
  `partial` (e.g. findings already validated) is **skipped, not re-run**

## Usage

```bash
# full run against the planted fixture (port 4488, localhost only)
node probe.js --mode=run --engagement=demo-1

# durability demo: SIGKILL mid-phase, then resume in a fresh process
node probe.js --mode=run-then-die --engagement=dur-1
node probe.js --mode=resume       --engagement=dur-1

# programmatic
import { createWorkflow } from './index.js';
for await (const ev of createWorkflow({...}).execute()) console.log(ev);
```

## Scope guard

The pipeline probes ONLY the planted sandbox fixture (`fixtures/vuln-app.js`,
bound to 127.0.0.1). No third-party target, no real offensive tooling is
invoked, and no tool output is simulated anywhere. The exploit gate is
absolute — and since Phase 8G it is double-locked: the doer's PoC AND an
independent verification (VERIFIED status + intact evidence snapshot) are
both required; findings without that never reach the report.
