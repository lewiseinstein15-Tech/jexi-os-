# Continual harness state — Phase 10 B

```js
import { createState } from './index.js';
const state = createState({ directory: '/session-owned/path/harness' });
const note = state.create('prompt-notes', { text: 'Cite the observed test output.' });
state.read('prompt-notes', note.id); // entry or null
state.update('prompt-notes', note.id, { text: 'Cite observed output and exit status.' });
state.list('prompt-notes');
state.delete('prompt-notes', note.id); // { removed: true }
state.basePrompt.read();
state.basePrompt.assertUnchanged();
```

The default directory is `.state/harness` relative to the caller's working
directory. Each session should supply its own directory. Modules for all four
collections export `bind(state)` for collection-specific CRUD, `collection`,
and schema validation. No existing harness adapter or runtime is modified.

## Data contract

- `prompt-notes`: nonempty `text` (supplemental only).
- `skills`: nonempty `name`, `description`, `whenToUse`.
- `memory`: nonempty `key`, JSON `value`; `provenance` defaults to the string
  `unverified:phase-25-pending`. This is a placeholder, not a verified tag.
- `subagent-specs`: nonempty `name`, `instructions`; additional JSON fields
  such as purpose, model preferences and limits are preserved as descriptions.

Inputs/outputs are defensive copies of JSON data. Updates shallow-merge fields;
IDs cannot be changed. Caller-supplied nonempty string IDs are accepted; generated
IDs hash canonical collection, entry and collection create ordinal. Thus identical
operation sequences give identical IDs/results/state. Wall-clock timestamps are
only in the journal and are masked for determinism comparison. Duplicate IDs,
missing update/delete targets, unknown collections and invalid data throw explicit
errors without appending a successful mutation. Reads/list do not journal writes.

## Persistence and append-only semantics

`operations.ndjson` is the authoritative event log. Each successful create,
update or delete appends one versioned record with sequence, operation, collection,
ID and ISO timestamp; create/update include the full resulting entry. Writes use
append mode and fsync before success. Reads reconstruct fresh state, so a second
instance sees completed writes. No API truncates, deletes or rewrites the journal.
An exclusive writer lock serializes check-and-append; contention fails explicitly
with `E_JOURNAL_BUSY`, not a lost update. This is not a tamper-proof filesystem.

Crash scope: acknowledged operations survive writer SIGKILL (live probe). A crash
*during* an operation can leave a stale `.lock` or incomplete tail. These fail
closed (`E_JOURNAL_BUSY` / `E_JOURNAL_CORRUPT`); B does not implement automatic
repair, lock stealing, journal compaction, or power-loss guarantees. Do not delete
a journal to recover. Future recovery needs explicit ownership and audit policy.
Replay is O(journal length); indexing and retention are not implemented here.

## Immutable boundary

`harness/immutable/base-prompt.js` exports a frozen Proxy facade around a private
constitutional string. Direct assignment, delete, defineProperty, prototype
changes and preventExtensions attempts throw `E_IMMUTABLE_VIOLATION` and append
an `immutable-violation` record. CRUD refuses base-prompt/immutable destinations.
`assertUnchanged(prior?)` compares prior reads and an optional supplied prior text.
Violation logs record the attempted operation, never proposed secret-bearing text.

The singleton logs to the default directory; `state.basePrompt` logs into that
state's journal. If the journal is unavailable, mutation still fails closed with
`E_IMMUTABLE_VIOLATION` and the logging failure in `error.cause`; an unavailable
filesystem cannot be promised an audit write. This API is not an OS sandbox and
cannot stop an authorized process from editing source files on disk.

Carry-forward (no out-of-zone files edited): runtime wiring, daemon crash recovery,
and Phase 25 provenance remain unimplemented. Scope A replay/async/VM limitations
are unchanged. No /refine implementation is claimed in B.

Probe: `node scripts/phase10-b-probe.mjs` (Node 22). It uses temporary directories,
actual disk writes, and a writer process killed by SIGKILL followed by a new reader.
