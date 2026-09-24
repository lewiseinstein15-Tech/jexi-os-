# WORKGRAPH

This directory hosts the workgraph-side trees: phase-loop planning and
session branching. The runtime planning service they complement lives in
the server (see "Related trees" below) — the two are intentionally
separate: this directory is a standalone library layer; the server
director owns the live mission loop.

## What lives here

- `phases/gsd/` — GSD (Get Stuff Done), a 5-phase loop (discuss → plan →
  execute → verify → ship) with fresh context between phases, ported from
  `open-gsd/gsd-core` (MIT). See `phases/gsd/README.md` for the phase
  table, API and loop points.
- `session/` — session JSONL tree: append-only stores with explicit
  branching, forking and reconstruction under `.jexi/sessions/`. See
  `session/README.md`.

## Related trees (runtime, server-owned)

- `server/src/services/director/WorkGraph.js` — L6 persistent
  dependency-aware plan used by the live director.
- `server/src/services/director/MissionRunner.js` — mission execution
  loop over the director plan.

This README previously named only the two server files and omitted the
trees that actually live here; it was reconciled by the consolidated
cleanup pass (ZONE-OWNER documentation-drift category).

See ../ARCHITECTURE.md for the full layer map.
