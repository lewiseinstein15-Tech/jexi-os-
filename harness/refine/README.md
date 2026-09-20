# Continual refinement — Scope C

`run(trajectoryId)` reads an existing JSON trajectory and applies one evidence-
backed supplemental prompt edit. `rollback(snapshotId)` restores all four mutable
collections to a saved point. Use `createRefine({state, directory,
trajectoryDirectory})` for explicitly scoped stores; module-level run/rollback
use `.state/harness`, its `refinements` subdirectory, and `.state/trajectories`.

A trajectory identifier resolves to an encoded filename under trajectoryDirectory.
An explicit `.json` path is also accepted. With no identifier, the latest JSON
file is selected (filename breaks equal-mtime ties). The consumer never writes a
trajectory. Existing Phase 7 JSONL journals are not silently treated as this JSON
format; conversion/production of trajectories is later integration work.

## Narrow evidence policy

The planner is deterministic, not an LLM and not a general natural-language
intent classifier. It selects the last dated, nonempty user_correction event,
cites the exact absolute file + event index, and preserves its detail verbatim
in one `text` patch. An entry ID derived from trajectory ID makes subsequent
corrections in that trajectory update the same supplemental note rather than
rewrite the collection. This scope supports that correction-to-prompt policy;
it does not invent skill, memory, subagent or deletion policies without an
explicit mapping contract. Missing evidence is E_NO_EVIDENCE. Constitution/base-
prompt requests are refused, not converted into supplemental overrides. The
applier re-plans against the source and state under the writer lock and rejects
forged, stale or broader proposals. Text matching is not a semantic safety filter;
all immutable destinations are independently excluded by this planner/applier API.

## Snapshot and journal semantics

Under the SAME writer lock used by Scope B, apply saves the complete mutable
state, proposal, originating store path and journal position to a content-addressed
snapshot. File and directory are fsynced before mutation. The file is read back,
hash checked and compared with the expected payload. `snapshotWriter` is the
explicit test seam; returning nothing or an invalid snapshot raises E_NO_SNAPSHOT
before state mutation. Snapshots contain trusted local data, not authentication
proofs against an attacker who controls the filesystem.

Rollback accepts any retained snapshot for the same store, including an older
snapshot after later refinements. It appends compensating delete/create records
so fields added since the snapshot disappear too. State is byte-identical when
serialized through the same list API; the journal is deliberately NOT rolled
back, truncated or made byte-identical. Each mutation records refinement action
and snapshot ID. `refinements.ndjson` also records apply/rollback, including no-op
rollbacks. This reconciles historical auditing with exact materialized-state
restoration. Snapshot files and trajectories are never rewritten by rollback.

Persistence proven here: kill AFTER acknowledged apply, restart in another
process, rollback. Crash DURING a multi-record rollback may leave partial state,
an incomplete tail or stale lock. Scope B fail-closed rules still apply; automatic
in-flight transaction recovery is not claimed. Concurrent journal reads are not
snapshot-isolated; writers use exclusive fail-fast locking. Runtime wiring,
trajectory conversion, recovery and provenance remain later concerns.

## Command disclosure

Only the body of commands/refine.command.js's handler changes. Its name, aliases,
description, category and args metadata are byte-for-byte unchanged. The handler
calls this module's run with args.session, then ctx.session.id, then latest JSON
fallback. Old imports, helper and comment remain untouched under the handler-only
scope rule; their Phase 7 description no longer documents the new handler's
input/output behavior. The prior implementation performed actual journal/learning/
trace proposal logic; that behavior is replaced, not retained. Programmatic run returns `{proposal,snapshotId,applied}` and throws explicit
errors. The command adds `ok: true` on success, catches only E_NO_EVIDENCE
and returns `{ok:false,reason:"no-evidence",message:"No refinement: no evidence in trajectory"}`.
Other failures remain explicit. Only the /refine assertions in server/test-commands.js
are updated under the specific Scope C authorization; no registry changes.

Run `node scripts/phase10-c-probe.mjs` with Node 22. A/B limitations are unchanged.
