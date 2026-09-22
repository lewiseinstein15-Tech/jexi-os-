# Arena worklog — CI failure sweep + follow-up fixes (2026-09-22)

## Ledger
- Task 1 (CI sweep): 6 fixes pushed DIRECT TO MAIN (187ae3c0, 2d225923, 4471d6fa,
  bc460f50, 93092cc1, c241bf1f). Lead review: accepted and green, but branch
  discipline (one-branch-per-scope, --no-ff merges, no direct-to-main) is a
  STANDING RULE from this point on. Logged; will not repeat.
- Follow-up fixes 1+2 run on branch `cleanup/ci-followup-1`, merged to main
  via the merges endpoint (--no-ff equivalent, two-parent commit).
- LEDGER CORRECTION (lead-logged, on the Phase 24 Scope 0 cleanup pass):
  commit 4a6a0ac over-deleted android/** raster BUILD resources (splash +
  ic_launcher) alongside evidence PNGs. Restored byte-identical from
  42c87cf8 on this branch. Consolidated cleanup to audit the same error class.

## Standing rule (process)
1. Every fix on its own branch (cleanup/<topic>-N).
2. Branch merges to main via --no-ff (two-parent merge commit).
3. No direct pushes to main outside the merge protocol.
