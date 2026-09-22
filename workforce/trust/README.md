# workforce/trust — Phase 13 Scope E — trust scoring + signing

Trust answers "who did what" (the agency-agents / nexus-agents pattern).
Actions and votes are **signed**, so a claim is verifiable instead of
asserted; trust is a **score that evolves with verified actions**.

```js
import { createTrust } from './workforce/trust/index.js';

const trust = createTrust();
trust.record('ui-designer', { kind: 'review', summary: 'approved PR #12' }, { verified: true });
trust.score('ui-designer');          // -> { score, history[] }

const { sig, payload } = trust.sign('ui-designer', { vote: 'approve', on: 'doc-7' });
trust.verify('ui-designer', payload, sig);   // -> { valid: true }
```

## Score curve (normative)

```
score = clamp01( w1·v1 + w2·v2 + w3·v3 + w4·v4 )
w = [0.10, 0.20, 0.30, 0.40]        (kind weights, KIND_WEIGHTS in scoring.js)
vk = count of VERIFIED actions of kind k
kinds 1..4 = routine | review | build | ship
```

- **Bounds [0, 1]**, enforced by the clamp; the curve is monotone in verified
  counts (e.g. 3 verified `ship` actions: 3 × 0.40 = 1.2 → clamped 1.0).
- **Verified actions are the only contribution.** An unverified action is
  recorded in history with its verdict but contributes zero — no partial
  credit, no decay, no penalty terms.
- **Deterministic**: the score is a pure function of the history ordered by
  op-seq. No wall-clock term, no randomness. The same history yields the same
  score in every process, byte-identically (values are pinned to 4 decimals
  for stable JSON).
- Unknown kinds fold to the last weight (w4), so the curve is total.

## Signing scheme (normative)

```
K0   = SHA-256("jexi-trust-v1")                       — domain key (a constant, not a credential)
key  = HMAC-SHA256(K0, "jexi-trust-v1:" + agentId)    — per-agent key, derived
sig  = HMAC-SHA256(key, canonicalJSON(payload))
hash = SHA-256(canonicalJSON(payload))
```

- **canonicalJSON**: object keys sorted lexically, arrays in order, no
  whitespace — same logical payload, same bytes, every run.
- The key is **derived deterministically from the agentId**; there is no key
  store and no credential literal anywhere in this scope. This is an
  *integrity* scheme, not a secrecy scheme: it proves a payload was issued
  under an agentId and was not altered in transit or storage. Anyone can
  re-derive a key, so it does not impersonate-proof a hostile host — stated
  here rather than implied.
- `sign(agentId, payload)` returns `{ sig, payload, hash }`; `hash` travels
  with the signature so a verifier can attribute a mismatch.

## Verification

`verify(agentId, payload, sig)` checks BOTH the signature and the payload
hash, in a declared, fixed order:

1. **Payload integrity** — the recomputed canonical hash must match the
   anchor (the expected hash when the caller passes one, else the payload's
   carried `hash`). Mismatch → `{ valid: false, reason: 'E_PAYLOAD_MISMATCH' }`.
2. **Signature** — the HMAC under the agent's derived key must match the
   expected signature. Mismatch → `{ valid: false, reason: 'E_SIG_MISMATCH' }`.

Payload-first ordering makes tamper attribution specific: a modified payload
reports `E_PAYLOAD_MISMATCH` even though the recomputed signature would also
fail. `{ valid: true }` requires both checks to pass.

## Contract

| call | result | refusals |
|---|---|---|
| `trust.record(agentId, action, { verified })` | `{ score, history }` | `E_UNKNOWN_AGENT` |
| `trust.score(agentId)` | `{ score, history[] }` | `E_UNKNOWN_AGENT` |
| `trust.sign(agentId, payload)` | `{ sig, payload, hash }` | `E_UNKNOWN_AGENT` |
| `trust.verify(agentId, payload, sig)` | `{ valid, reason? }` | `E_UNKNOWN_AGENT` |

Agent existence is resolved against recorded trust state first, then the
Scope A roster (read-only). An agentId in neither is `E_UNKNOWN_AGENT` —
carried on **`StrategyError`** (from `workforce/nexus/strategy.js`), per the
Phase 13 one-class-per-layer taxonomy. No layer-local error class of any
kind is introduced; every throw in this scope is the shared class.

## Persistence

State lives in `workforce/trust/state/` (gitignored — runtime state):

- `trust-seq.txt` — the op-seq counter (one integer + newline). Every record
  consumes one; ordering is by op-seq, never by wall clock.
- `trust-state.json` — `{ scheme, seq, agents: [{ agentId, history[], ops }] }`
  with the exact recorded actions and verdicts.

Reload replays the file verbatim (no recomputation of history), restores the
counter, and is byte-identical. A seq file without a state file is a half
write and is refused, not silently reset.

## Files

- `scoring.js` — the declared curve: weights, clamp, pure `scoreOf(history)`.
- `signing.js` — derivation + HMAC signing + canonicalJSON + payload hash.
- `verify.js` — the verification path with declared attribution order.
- `index.js` — the `createTrust` facade: contract surface, ledger, persistence.
