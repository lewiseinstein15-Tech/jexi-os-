# workforce/nexus — NEXUS strategy layer

The layer above the divisions. Given an intent, it decides which strategy
governs the work, which division owns it, and which agent takes it — and records
why.

```js
import { createNexus } from './workforce/nexus/index.js';

const nexus = createNexus();
nexus.load();
nexus.route({ kind: 'research', description: 'size the TAM for the new product line' });
```

    nexus.load(root)                -> { strategies: [] }
    nexus.route(intent, context?)   -> { strategy, division, agent, reason, warnings, ... }
    nexus.validate(intent)          -> { valid, errors? }
    nexus.get(strategyId)           -> strategy   (unknown id -> E_UNKNOWN_STRATEGY)

## Modules

| File | Role |
|---|---|
| `strategy.js` | Strategy schema, validation, routing tokens |
| `docs.js` | Reads the committed projection from `vendor/` |
| `orchestration.js` | Intent → strategy → division → agent, with a reason |
| `index.js` | Facade and lazy default router |
| `vendor/` | Projection of the upstream NEXUS tree + provenance (`vendor/README.md`) |

## Route result

`reason` is a human-readable sentence explaining the decision and is a real
string on every successful route, never a placeholder. It names the intent, the
strategy and how it was matched (an explicit `context.strategyId`, or the intent
kind matching a declared strategy token), the candidate reference and its index
within the strategy's list, and the roster agent it resolved to.

`reason` states that the chosen agent is the strategy's **first-listed able
candidate**. That is literally what routing does: candidacy is evaluated in the
order the strategy lists its candidates, and the first one that resolves, is
unambiguous, and satisfies the context filters wins. There is deliberately no
scoring or ranking pass — list order is the intended behavior for this scope, so
the wording claims only the property the code actually has.

`warnings[]` is empty on a clean route. It is populated when a candidate
reference fails to resolve, with one string per failure:

    unresolved candidate reference: <name>

This exists because an unresolvable reference is otherwise indistinguishable
from a deliberate route to the next candidate — both produce the same
lower-ranked agent and neither throws. With `warnings` populated, a caller can
tell "routed to the first choice" apart from "skipped a reference that broke",
which is what an upstream agent rename looks like from here. A warning is not an
error: routing continues to the next candidate. Only when *no* candidate is able
does routing refuse with `E_NO_AGENT`.

## Refusals

Routing never falls back silently. A refusal carries a stable `code`:

| Code | When |
|---|---|
| `E_NO_STRATEGY` | No strategy matches the intent kind, or a token is claimed by more than one strategy |
| `E_NO_AGENT` | A strategy matched but no candidate was able |
| `E_UNKNOWN_STRATEGY` | `context.strategyId` names a strategy that does not exist |
| `E_INVALID_INTENT` | The intent is missing `kind` or `description` |

## Read-only dependencies

Scope A (the agent roster) and Scope B (the divisions) are consulted
read-only. A route reads membership and capabilities; it never assigns an
agent, never mutates a membership, and never writes a file.

## Determinism

The same intent against the same roster and divisions produces a byte-identical
result. Strategies sort by id, candidates keep upstream order, and there is no
clock, randomness, or unordered-set iteration in the route path.
