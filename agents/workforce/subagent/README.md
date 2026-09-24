# Nuclear-family A2A and retained subagents — Scope F

```js
import { createSubagents } from './index.js';

const graph = {
  agents: [
    { id: 'R', parentId: null, role: 'root', state: 'live' },
    { id: 'P', parentId: 'R', role: 'parent', state: 'live' },
    { id: 'A', parentId: 'P', role: 'worker', state: 'live' },
    { id: 'B', parentId: 'P', role: 'worker', state: 'live' },
  ],
};
const subagents = createSubagents({ graph }); // .jexi/subagents by default

subagents.messaging.send('A', 'P', { kind: 'task', payload: { text: 'hello' } }, graph);
const inbox = subagents.messaging.receive('P');
subagents.messaging.ack('P', inbox.map(message => message.id));
```

## Family boundary

`family.assertInScope(from, to, graph)` allows exactly an agent's direct parent,
direct children, and siblings that have the same non-null `parentId`. It returns
`{ allowed: true, relation: 'parent'|'sibling'|'child' }` for those three cases.
Everything else returns `E_OUT_OF_FAMILY` with a relationship-specific reason.
Examples include `uncle`, `nephew`, `cousin`, `grandparent`, and `stranger`.
An invalid/cyclic graph fails closed with `E_AGENT_GRAPH`.

Thus a child can message its parent and siblings, while a parent can message its
children and its own sibling. An uncle/aunt, nephew/niece, cousin, grandparent,
and stranger are not allowed. This is graph-only logic: no RLM daemon or session
tree is read or written.

## Messaging and durability

`messaging.send(from, to, { kind, payload }, graph)` first applies the family
boundary and then fsyncs one JSON state file before returning an envelope ID. Its
result has `{ delivered, queued, messageId? }`; a `live` recipient is
`delivered:true`, and an `evicted` recipient is `queued:true, delivered:false`.
Both kinds stay in the recipient FIFO inbox until `receive(agentId)` drains it.

Each returned message is:

```js
{ id, from, to, kind, payload, ts, delivered }
```

`receive()` atomically moves FIFO entries to a durable inflight receipt set before
returning them. A process killed after receive but before acknowledgement will
receive the same IDs again on a fresh process; consumers deduplicate by `id`.
`messaging.ack(agentId, messageIds)` is the optional durable completion step that
removes those replayable entries. This is at-least-once delivery, not exactly-once.

Records live at `.jexi/subagents/<agentId>.json` (or the supplied `directory`),
with atomic replace plus file and directory fsync. The Scope F probe kills a real
writer process after two acknowledged sends and receives both messages from a
fresh process. The local writer lock is fail-fast; automatic stale-lock,
interrupted-write, and power-loss repair are not claimed.

## Retention and discovery

- `retention.persist(agentId)` writes the agent record and returns `persistedAt`.
- `retention.evictIdle(thresholdMs = 30 * 60 * 1000)` persists an idle live agent
  as `evicted` before changing the in-memory graph. It does not delete its file
  or inbox.
- `retention.restore(agentId)` reads retained state, marks it `live`, and restores
  it to the in-memory graph. Missing records return `{ restored: false }`.
- `discovery.list()` returns deterministic ID-sorted `{ id, parentId, state,
  lastActivityAt, role }` records. Resident in-memory graph entries take
  precedence; persisted entries remain visible when not resident.

The supplied graph is owned by the caller and is normalized with default
`state:'live'`, `role:'subagent'`, and `lastActivityAt` if those fields are
omitted. Scope J may later attach these primitives to a zone owner; Scope F does
not integrate any daemon, session tree, server, or event subsystem.

Probe: `node scripts/phase10-f-probe.mjs` (Node 22).
