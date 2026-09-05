# JEXI Evaluation Suite — results over time

6 categories × 10 tasks (spec §47), deterministic and keyless. Run `node evaluation/run.js` from `server/`.

Honest limitation: memory-transfer tasks require a lexical bridge between domains (a shared distinctive token). Pure-synonym transfer with zero shared tokens is not yet retrievable — that needs embedding-based recall (future work), and until then a no-match returns nothing rather than a guess.

| Date | short | multi-step | unfamiliar | failure-recovery | tool-discovery | memory-transfer | Overall |
|---|---|---|---|---|---|---|---|
| 2026-09-05 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | **1.000** |
