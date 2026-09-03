# FIXLOG B201 — the completeness pass: short deliverables get finished

**Date:** 2026-09-03 · **Report:** Test B residual — *"you asked for 10 lessons,
the model delivered 1 and asked 'want another?'"*

## The bug

Every prior fix routed and persisted correctly, but a weak fallback model
(the day's provider quotas were exhausted) still **stopped early on counted
deliverables**: "10 lessons" came back as 1–4 lessons, shipped as success.
The pipeline had no concept of "the user asked for N, you delivered M < N".

## The fix

**`DeliverableContinuation`** — at the terminal seam (before `done()`), a
counted file deliverable whose summary holds fewer file blocks than
requested gets continuation passes:

- `parseRequestedCount` reads the count from the query ("10 lessons",
  "lesson-01 through lesson-10", "twenty chapters"; capped at 40)
- each round infers the missing filenames from the delivered pattern
  (`lesson-01..04` → `lesson-05.md … lesson-10.md`) and asks for exactly
  those, in the same `**file** + fenced-block` format
- the reply's blocks append to the answer — the user's chat answer grows to
  include everything; the FileBlockWriter persists all of it (dedup by
  filename — a continuation can never double-write)
- every round **narrates live**: *"My draft covered 5 of 10 — writing the
  rest now."*
- honest stops: max 4 rounds, and a round that adds nothing ends the loop
  (no infinite churn on a dead model)

Plus one bug it exposed in B162's coworker masking: `sanitizeStreamText`
ate **fractions and scores** — the log line "completeness pass: 5/10 files"
rendered as "completeness pass: **Tessa** files" because `5/10` matched the
unknown-model-id pattern. Numbers with `/` (5/10, 16/9) are now protected.

## Live result (round 7, quota-dead providers)

0 of 10 lessons in the draft → round 1 → 5 of 10 → round 2 added nothing
(weak model, honest stop) → **5 complete lesson files on disk, all sections,
correct Swahili** (Moja/Mbili/Tatu…), 33.6s total, narrations at every step.
With healthy providers the same loop closes the gap fully.

Tests: `server/test-b201.js` (14 checks) + 4 masking checks in
`test-model-coworkers.js`.
