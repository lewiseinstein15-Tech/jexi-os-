# JEXI OS — PHASE 21 — AUTORESEARCH INTEGRATION — execution plan

## Zone (HARD LOCK)
Create/edit/delete ONLY under `research/**` and `scripts/phase21-*.mjs`.
Never touch: server/**, security/**, capability/**, web/reach/**, runtimes/browser/**,
context/viking/**, skills/**, AGENTS.md, .jexi-secrets/, workforce/divisions.json,
commands/registry.js, events/hud/**.

## Step 0 (DONE, verified via ls-remote)
- git checkout main; git pull; checkout -b phase-21-freebuff; tag pre-phase-21-freebuff.
- Pushed branch + tag. Raw ls-remote output captured in session log:
  refs/heads/phase-21-freebuff        e7e0e1f1802b09f4b0ffa90e68ccaaa49a8e2efd
  refs/tags/pre-phase-21-freebuff     e7e0e1f1802b09f4b0ffa90e68ccaaa49a8e2efd

## Research notes — karpathy/autoresearch (read, not copied)
- Three files that matter:
  - prepare.py — constants, one-time data prep (download data, BPE tokenizer), runtime
    utilities (dataloader, evaluation). Agent must NOT modify it (read-only).
  - train.py — the single file the agent edits (model, optimizer Muon+AdamW, training loop).
  - program.md — baseline instructions / "super lightweight skill"; edited by the HUMAN,
    read by the agent each cycle.
- Loop: agent modifies train.py -> runs training -> metric val_bpb (lower is better,
  vocab-size-independent) -> improve => git commit (keep), no-improve => git reset (discard)
  -> repeat overnight (~100 experiments/8h at fixed 5 min budget).
- Fixed 5-minute wall-clock budget per experiment (excluding startup/compile) makes runs
  comparable regardless of what the agent changes.
- Dual tracking: git branch = frontier of successful commits only; results.tsv = complete
  log (kept + discarded).
- Design: single file to modify keeps diffs reviewable; self-contained; one GPU, one file,
  one metric. program.md is human-iterated "research org code".
- Adaptation for JEXI: metric is a numeric score from a runnable target (toy target in
  probes); experiment = edit a candidate implementation file; keep/discard via git
  commit/reset on a dedicated tracking branch; log appended to results.tsv; program.md is
  strategy + constraints loaded fresh each cycle.

## Scopes (one commit each, probe => report => STOP => wait for go-ahead)
- (A) research/loop/: experiment-loop.js, lifecycle.js, scheduler.js
- (B) research/constraints/: read-only.js, mutable.js, guards.js
- (C) research/program/: program.md, parse.js, load.js
- (D) research/budget/: wall-clock.js, cost.js
- (E) research/tracking/: frontier.js, log.js, dual.js
- (F) research/workgraph/experiment-node.js (adapter only; NEVER server/src/workgraph/**)
- (G) research/simplicity/scorer.js
- (H) research/swarm/: research-swarm.js, dedup.js, shared-frontier.js
- (I) research/templates/: template.skill.js, registry.js
- (J) research/overnight.js
- (K) final gate: tag pre-phase-21-final, full suite, re-run probes, invariant grep, CI check

## Probes
All live probes run via scripts/phase21-*.mjs (one per scope), raw stdout pasted in report.
Toy target for probes: research/fixtures/toy-target/ (a tiny Node "training" script whose
error decreases as the candidate file improves — stands in for val_bpb).

## Environment gotchas
- Node test harness: never run nested `node --test` as a child under a `node --test`
  parent (recursion guard makes it silently pass). Use plain assertion scripts.
- DOTENV_CONFIG_QUIET=true silences dotenv stdout noise.
- Bash on all OSes; POSIX syntax only.
