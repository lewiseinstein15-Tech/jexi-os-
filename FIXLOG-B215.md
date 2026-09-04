# FIXLOG B215 — Structured Objective State + World State (Ultimate Autonomy spec, Phase 1)

User directive: the "JEXI OS — ULTIMATE AUTONOMY + GENERAL INTELLIGENCE + HUMAN-FIRST UI
EVOLUTION" master spec (61 parts). Per its own Part 0 (and standing rules): controlled
phases, inspect first, integrate rather than replace, honest statuses only.

## Phase 1 scope (this build)

1. **Full architecture audit** → `docs/JEXI_ARCHITECTURE_AUDIT.md` (traced execution
   paths, not filenames; statuses WORKING/PARTIAL/MISSING/BLOCKED; FE→BE wiring check
   11/11; mock/TODO scan clean; honest gap table with phases).
   Headline: the B208–B213 director lane already SHIPS most of Parts 2–28 with 588+
   passing checks. The genuinely missing pieces: Part 4 structure, Part 9 world state,
   and the whole Parts 32–51 frontend evolution.

2. **Part 4 — ObjectiveInterpreter** (`server/src/services/director/ObjectiveInterpreter.js`):
   `structureObjective(refinement, raw)` turns the Director's interpretation into an
   explicit structured objective state where every requirement is provenance-tagged:
   - USER_STATED (≥60% significant-token overlap with the user's verbatim message)
   - INFERRED (the interpreter's reconstruction)
   - ASSUMED (from assumptions[])
   - UNKNOWN (from unknowns[] — LANE-PROVIDED ONLY, never fabricated)
   Plus desiredOutcome (fallback INFERRED, honest), requiredCapabilities (derived from
   the real subtasks), requiredArtifacts (pass-through, [] when absent),
   provenanceCounts, laneProvided honesty flags. Old-schema lanes degrade gracefully.
   Wired: INTERPRET_SYSTEM schema upgraded (+desiredOutcome/unknowns/requiredArtifacts),
   Director stores `task.structuredObjective`, persists it with the task record, and the
   OBJECTIVE_INTERPRETED event carries provenance counts (frontend-visible).

3. **Part 9 — WorldState** (`server/src/services/director/WorldState.js`):
   Explicit persisted environment state per mission (+ global), updated ONLY by real
   actions: every employee command round records the process (cmd, exit, ms, blocked
   reason) + the REAL workspace file inventory; browser rounds record available/blocked
   with the real reason; workspace publishes record repo/slug/live; network observations
   come from real operations only. `summaryBlock()` feeds the MissionRunner plan prompt
   ("plan from what EXISTS, not assumptions"; an empty world says so honestly).
   `runtimeCapabilities()` reports real process facts (node version, command allowlist,
   browser availability with the slim-image BLOCKED reason). Exposed at
   `GET /api/missions/:id/world` for the future UI (B216). Atomic tmp+rename persistence,
   bounded lists (60 processes / 200 files / 40 repos), best-effort recording that can
   never fail execution.

## Tests — `server/test-b215.js` (44 checks, all passing)

- §1 ObjectiveInterpreter pure units (17): tagging rules, degradation, tokenizer,
  null-safety, counts consistency.
- §2 Director integration (4): turn → event carries provenance → structuredObjective
  PERSISTED to disk with the task record → tags intact on reload.
- §3 WorldState (16): honest-empty contract, process/file dedupe, browser blocked
  reason, publishes, persistence round-trip, seq advance, bounded lists,
  runtimeCapabilities env switch (BLOCKED under JEXI_NO_BROWSER=1, available without).
- §4 REAL execution seam (5): a Forge session writes calc.js and REALLY runs
  `node calc.js` (CommandRunner, exit 0) → the world record under the MISSION id
  contains the real process + the real files (calc.js, result.txt).

Chain: `test-b215.js` appended to `npm test`. Full chain green before push (see CI).

## Files

- NEW `server/src/services/director/ObjectiveInterpreter.js`
- NEW `server/src/services/director/WorldState.js`
- NEW `server/test-b215.js`
- EDIT `RealAdapters.js` (schema), `Director.js` (hook), `TaskState.js` (field),
  `EmployeeSession.js` (command/browser seams + workspace observation),
  `MissionRunner.js` (world block in plan prompt), `index.js` (world route + publish
  recording), `package.json` (chain), `docs/JEXI_ARCHITECTURE_AUDIT.md` (gap statuses).

## Honest limits (not converted to PASS)

- requiredArtifacts/unknowns depend on the model lane actually returning the B215
  fields; lanes that don't get honest empty lists (laneProvided flags expose this).
- WorldState v1 records commands, files, browser, publishes, network — NOT yet: git
  branch state, OS process table, multi-host environments.
- No UI for world state yet (B216: MissionsScreen world panel + work-graph visual).
- Parts 32–51 (frontend evolution) deliberately NOT started in this phase — the spec
  forbids rushed one-pass implementation; B216 is the dedicated session.
