# workforce/identity — identity graph

Answers "who is who" across the roster. Every agent gets a stable DID; display
names are aliases that resolve to a DID; two DIDs that turn out to be the same
entity can be merged, and the merge is recorded as an edge so the absorbed DID
keeps resolving to the survivor.

```js
import { createIdentityGraph } from './workforce/identity/index.js';

const g = createIdentityGraph();
g.create({ id: 'ui-designer', name: 'UI Designer' });
g.create({ id: 'design-ui-designer', name: 'UI Designer' });
g.resolve('UI Designer');   // throws E_AMBIGUOUS_IDENTITY — two live identities share the name
g.merge('did:jexi:ui-designer', 'did:jexi:design-ui-designer');
g.resolve('UI Designer');   // -> did:jexi:ui-designer
```

    identity.create(agent)             -> { did, agentId }
    identity.resolve(nameOrAlias)      -> { did, agentId }
    identity.merge(didA, didB)         -> { merged, survivor, absorbed, aliases, seq }
    identity.aliases(did)              -> [strings]
    identity.graph()                   -> { nodes, edges }

## DIDs

A DID is `did:jexi:<agentId>` — the W3C DID grammar's `did:<method>:<id>` shape,
method `jexi`, with the agentId as the method-specific id.

It is a **pure function of the agentId**. No registry, no random suffix, no
clock. `toDid('ui-designer')` is always `did:jexi:ui-designer`, so two
independent graphs agree on identity for the same agent, and a merge can be
recorded as an edge between stable endpoints instead of a renumbering.

The agentId is used verbatim, so an agentId containing `:` or whitespace would
not round-trip; `toDid` refuses those with `E_INVALID_DID` rather than emitting
a DID that parses back differently.

## Merge semantics

    merge(didA, didB) -> survivor = the older DID by creation op-seq

"Older" means **the lower sequence number**, never an earlier wall-clock time.
There is no clock anywhere in this module. Every mutation takes the next value of
a monotonic counter that is persisted, so a survivor stays the same across
reloads.

On merge:

- the absorbed node's aliases — and the aliases of everything already absorbed
  into it — fold into the survivor;
- the absorbed node gets `mergedInto = survivor`;
- an edge `{ from: absorbed, to: survivor, seq }` is appended;
- `resolve()` on the absorbed DID, or on any of its aliases, returns the
  survivor afterwards.

Merging two DIDs that already share a root is refused with **`E_CYCLE`**. With
oldest-wins ordering that is the only reachable cycle, and it is refused rather
than treated as a no-op so a redundant merge cannot be mistaken for a real one.

## Refusals

`IdentityError` carries a stable `code`, following the same pattern as
`SpecError` (Scope A), `DivisionError` (Scope B) and `StrategyError` (Scope C).

| Code | When |
|---|---|
| `E_UNKNOWN_IDENTITY` | `resolve` finds no node or alias; `merge` names an unknown DID |
| `E_DUPLICATE_AGENT` | `create` for an agentId that already has a node |
| `E_CYCLE` | merge would make an identity absorb itself |
| `E_AMBIGUOUS_IDENTITY` | an alias is held by more than one live identity |
| `E_INVALID_AGENT` | `create` without a usable agentId, or a corrupt graph file |
| `E_INVALID_DID` | `toDid` / `parseDid` given something that is not a JEXI DID |

## Ambiguity is reported, not guessed

`E_AMBIGUOUS_IDENTITY` is the reason this module exists. The roster contains 12
display names held by two agents each — a canonical agent and its vendored twin
(`ui designer` → `ui-designer` + `design-ui-designer`, and 11 more). A graph
that resolved those by insertion order would silently pick one.

This graph refuses instead, lists the candidate DIDs on the error, and waits for
an explicit `merge`. Seeding from the roster therefore creates one node per
agent and leaves the duplicate names ambiguous; it does not collapse them.

## Persistence

State lives in `workforce/identity/state/` (gitignored — it is runtime state,
not source):

    identity-seq.txt      the last allocated sequence number
    identity-graph.json   nodes, alias edges, and their seqs

Load is lazy via the default graph, or explicit:

```js
const g = createIdentityGraph();
g.load();                 // missing state = empty graph, not an error
g.load('/some/dir');      // load from elsewhere
```

Writes are atomic: a temp file in the same directory, then `rename` over the
target, so a crash mid-write cannot leave a half-written graph. A malformed file
or a persisted cyclic merge chain raises `E_INVALID_AGENT` / `E_CYCLE` rather
than silently starting over, because starting over would change identities.

`createIdentityGraph({ persist: false })` keeps a graph entirely in memory.

## Determinism

`graph()` sorts nodes by DID and edges by `(from, to)`. Two builds over the same
inputs produce byte-identical output. No clocks, no randomness, no unordered
iteration in the output path.

## Read-only with respect to the roster

`resolve.js` reads Scope A's roster to find duplicate names
(`duplicateNames`, `duplicateReport`, `seedFromRoster`) and never writes to it,
never assigns, and never mutates a spec.
