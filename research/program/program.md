# Research Program — JEXI autoresearch loop

> HUMAN-EDITABLE FILE. The research agent reads this fresh every cycle and must
> never modify it (enforced by research/constraints). Edit the Strategy section
> to steer the research; edit Constraints to bound it. The agent adapts its
> experiments to whatever is written here — that is the whole interface.

## Strategy

Optimize val_metric on the toy target (lower is better, analog of val_bpb).
Prefer single-parameter changes over structural rewrites: one knob per
experiment, so keep/discard verdicts attribute cleanly.
Hill-climb from the current frontier; when two experiments tie, keep the one
with fewer changed lines (simpler wins ties).
Stop proposing experiments in a direction after two consecutive discards.

## Constraints

- judge: research/fixtures/toy-target/train.js is read-only — never edit the eval
- data: research/fixtures/toy-target/data.js is read-only — never reshape the dataset
- metric: use val_metric exactly as printed by the judge; no re-deriving it
- budget: each experiment runs under the fixed wall-clock budget (Scope D)
- log: every experiment (kept, discarded, crashed) must land in results.tsv (Scope E)
- zone: only the candidate file and the sandbox are editable; everything else fails closed
- honesty: a crashed run is a crashed run — never report it as an improvement
