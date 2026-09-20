# Session JSONL tree — Scope E

```js
import { createSessions } from './index.js';
const sessions = createSessions(); // .jexi/sessions/<sessionId>.ndjson
const store = sessions.store('A');
const root = store.append({ parentId: null, kind: 'turn', payload: { text: 'start' } });
const next = store.append({ parentId: root.id, kind: 'turn', payload: { text: 'next' } });
const fork = sessions.branch.fork('A', root.id);
const branchStore = sessions.store(fork.newBranchId);
branchStore.append({ parentId: fork.newBranchHeadId, kind: 'turn', payload: { text: 'alternative' } });
sessions.tree.reconstruct('A', { branch: fork.newBranchId });
sessions.compact.run('A', { threshold: 20 });
```

## Locked-in ancestor-prefix semantics: TWO views

Each branch is single-parent and linear; appends must extend its current head.
Forking at N freezes exactly the ancestry through N inclusive. It never includes
parent descendants after N. Branches share logical ancestor IDs, implemented as
copy-on-write prefix snapshots in each branch's own NDJSON file (not filesystem
hard links or mutable object references). Future parent updates do not rewrite
the frozen prefix. `opts.sessionId` can explicitly name a fork or clone.

`tree.reconstruct(sessionId)` returns the UNION of distinct node IDs in the
session's family, with parent-to-child edges and rootId. Multiple children are
allowed in the union, never multiple parents. Pass `{branch: branchId}` for an
additional `branchView` containing `branchNodeIds`, `branchHeadId`, and `nodes`.
The branchView.nodes field includes that branch's payload overrides. Union
identity deduplication prioritizes the original family root session, then branch
IDs in lexical order. The union is a topology view, NOT a merge of conflicting
branch-local payloads: read the explicit branch view for those values.

Example: parent 0→1→2→3→4; fork at 2 plus 3 new nodes:
- parent branch = 5, head 4;
- fork branch = 6, head 5';
- union = 8; shared IDs are exactly 0,1,2.

`fork()` returns `{newBranchId,newBranchHeadId,branchNodeIds,unionNodeCount}` at
fork time. The extra newBranchId is the handle for subsequent appends. At fork
time the head is N; fetch branchView again after appending to obtain its new tip.
`store.update(id,payload)` appends a branch-local replacement payload event; it
never overwrites an old record or changes identity/parent links. Clone copies the
selected branch view into a separate family with all-new IDs, independent of
future parent or clone appends. It does not copy sibling branches from the union.

## Journal and compaction

All session files are real append-only NDJSON. The first record is session
metadata plus an optional frozen prefix; later records are append, update,
checkpoint or compact events. Envelope seq values are contiguous per file.
Node seq is the creation-record sequence and remains stable after revisions or
compaction. Payloads must be JSON data. IDs and generated node sequences are
deterministic for the same ordered operations; timestamps are caller-supplied or
wall-clock, and masked for determinism testing.

`compact.run(id,{threshold})` checks logical length (default 20) and appends a
lossless checkpoint plus a compact marker. Linear interiors become summary nodes
while root, tip and union branch-point boundaries remain explicit. There is no
LLM-generated lossy summary: summary payloads identify the exact covered IDs and
the checkpoint. `compact.physical(id)` exposes the active compact representation;
`compact.reconstruct` and `tree.reconstruct` replay the checkpoint to return the
ORIGINAL logical nodes. On an isolated 20-node chain: before=20, after=3, logical
count=20. The physical active view shrinks; the disk journal does NOT shrink
(21 lines become 23). No history is deleted. Below threshold returns unchanged
counts with checkpointId=null. Already-compacted views do not append redundant
markers. Later append/update invalidates the active compact view; call run again
when ready. Existing checkpoints remain available in the journal.

## Durability and limits

Writes use one fail-fast exclusive directory writer lock, append mode and fsync
before returning. Parent validation and duplicate-ID checks occur before writes.
Acknowledged append → actual SIGKILL → fresh process reconstruction is probed.
Readers reconstruct on demand, without shared in-memory caches. Existing private
cache directory ownership is the caller's responsibility; new dirs/files use
0700/0600. `.jexi/` is already ignored; no gitignore modification is needed.

No merge nodes, autoscheduler, daemon integration or Phase 4 workgraph mutations
are included. Reads are not transaction-isolated from concurrent appends; corrupt
or incomplete tails fail closed. Kill during a write can leave a stale writer
lock/partial record; automatic lock repair and power-loss recovery are not
claimed. Prefix/checkpoint copies favor transparency over storage efficiency;
union reconstruction scans session files. Never manually remove a family's root
journal and expect lineage ownership to survive. These are trusted local files,
not a hostile-filesystem security boundary.

Probe: `node scripts/phase10-e-probe.mjs` (Node 22).
