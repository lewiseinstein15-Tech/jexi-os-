# COST CAPS (Phase 9 E)

Per-session and per-provider spend tracking with a soft warning and a
terminal hard cap. A session that burns through its budget is stopped —
the cap is not advice, it is a refusal.

## Modules

| File        | Role |
|-------------|------|
| `caps.js`    | threshold engine (`check`, `record`, `reset`, `ledger`, `createCaps` factory) |
| `tracker.js` | dumb per-session + per-provider ledger, integer micro-US$ money, optional atomic persistence |

## Contract

```js
import { caps } from 'providers/cost/caps.js';

caps.check({ sessionId, providerId, spendUsd, budgetUsd })
// → { state: 'ok' | 'warn' | 'cap',
//     reason?,                 // present when warn/cap (deterministic string)
//     pct,                     // spend/budget * 100, 2 decimals
//     remainingUsd,            // >= 0, never negative
//     spendUsd, budgetUsd, sessionId, providerId,
//     preflight,               // true when spendUsd was a PROPOSED total (not recorded)
//     warnEmitted, warnAlreadyEmitted,  // warn-once evidence
//     terminated }             // true once capped (terminal)

caps.record({ sessionId, providerId, usd })
// → { ok: true, usd, providerUsd, sessionTotalUsd, entry (updated ledger entry) }
// throws CapsError E_SESSION_CAPPED when the session is terminated
// (the refused attempt is still logged in the ledger's `attempts`)

caps.reset(sessionId?)   // clear ONE session, or ALL when omitted
```

`check({ spendUsd })` evaluates a **proposed** total without recording it —
that is the pre-call gate a provider bridge uses (projected spend = ledger
total + estimated cost of the next call). `record()` is the post-call
truth: it writes what was actually spent.

## Thresholds

| Band            | State  | Behavior |
|-----------------|--------|----------|
| 0–79% of budget | `ok`   | spend flows |
| 80–99%          | `warn` | ONE warning per session per threshold value — never re-fires on every check (no spam) |
| 100%+           | `cap`  | session TERMINATED — every further `record()` refuses with `E_SESSION_CAPPED` |

- Boundaries are **inclusive** (`>=`): exactly 80% warns, exactly 100%
  caps. Defaults: warn `0.8`, cap `1.0`.
- Configurable per instance: `createCaps({ warn: 0.5, cap: 0.75 })`.
  Module-default thresholds overridable via env
  `JEXI_COST_WARN_THRESHOLD` / `JEXI_COST_CAP_THRESHOLD`. Validation is
  fail-fast (`E_INVALID_THRESHOLDS` — requires `0 < warn <= cap`); a
  misconfigured cost guard fails loud, never silently off.
- Warn-once is keyed **per threshold value**: changing the threshold
  re-arms the warning (a new threshold is new information). Evidence
  lives in the ledger: `warnings[]` (append-only events) and
  `warnFired{threshold → at}`.
- The warning fires from whichever path observes the crossing first —
  `check()` or `record()`. Both share one evaluate() so the verdicts
  agree (P10 determinism).

## Cap is terminal

- The record that **crosses** the cap is accepted and written: the model
  call already happened upstream — refusing to ledger it would falsify
  spend data. The session flips `capped: true` at that moment.
- Every further `record()` throws `E_SESSION_CAPPED` with the cap reason;
  the refused attempt is appended to `entry.attempts` (bounded at 50) so
  the refusal is auditable without pretending the money moved.
- `check()` never un-caps. While `capped`, `check()` reports `state:
  'cap'` and `terminated: true` regardless of any arithmetic.
- Cap fires even if the caller never calls `check()` — `record()`
  self-evaluates thresholds after every write (defense in depth).

## Reset semantics

`reset(sessionId)` deletes the whole session entry — spend, per-provider
breakdown, warning events, and the cap flag. It is **irreversible** and
it is the only way out of a capped session. `reset()` with no argument
clears every session and returns the count. Resetting an unknown session
returns `cleared: 0` (not an error — idempotent cleanup).

## Money representation

Money is stored as **integer micro-US$** (`1 USD = 1_000_000 µ$`), not
floats. Binary floating point cannot accumulate currency (`0.1 + 0.2 !==
0.3`): a session recording $0.01 a hundred times must land EXACTLY on
$1.00 or the hard cap fires late. Integer micros make the accumulation
exact; USD appears only at the API boundary, rounded to 1e-6
(`usdToMicros` / `microsToUsd` in tracker.js). Negative or non-finite
spend is refused (`E_INVALID_SPEND`); zero is allowed (a cache hit is a
legitimate zero-cost record).

## Budget semantics

`budgetUsd` is passed once to `check()` or `record()` and cached in the
ledger. Passing it again updates the cache — **last-writer-wins**;
budget changes are an operator action, not something the engine hides.
With no budget known, `check()` fails `E_NO_BUDGET` instead of guessing.
Thresholds apply to the SESSION total; the per-PROVIDER ledger
(`entry.providers`) is tracked for attribution (P7) — per-provider
budgets are a deliberate future extension, not silently conflated here.

## Persistence

- **Default: in-memory.** Cost caps guard a LIVE session; the runtime
  opts into durability by passing `persistPath` to
  `createTracker({ persistPath })` (or env `JEXI_COST_LEDGER_PATH` for
  the module default). A restarted process without a persisted ledger
  loses spend memory — that is a deployment choice, made explicit.
- Persisted writes are atomic (`<path>.tmp` + `rename`), JSON
  (`{ version, savedAt, sessions }`), one writer per process. Multi-
  process writers would need file locking — out of scope.
- A corrupt or foreign-version ledger REFUSES to load
  (`E_LEDGER_CORRUPT`) instead of starting from zero: silently wiping
  spend memory would let a restart bypass a cap that was already earned.
- Warning-once state persists with the ledger — a restart does not
  re-spam the warning (probed in P10 across two real processes).

## Error codes

| Code | Thrown by | Meaning |
|------|-----------|---------|
| `E_SESSION_CAPPED` | `record()` | session terminated — further spend refused (attempt logged) |
| `E_NO_BUDGET` | `check()` | no `budgetUsd` param and nothing cached |
| `E_INVALID_BUDGET` | `check()`/`record()` | budget not finite / <= 0 |
| `E_INVALID_SPEND` | `record()`/`check()` | spend negative / non-finite |
| `E_INVALID_THRESHOLDS` | `createCaps()` | thresholds not (>0, warn <= cap) |
| `E_INVALID_ARG` | all | missing/empty sessionId or providerId |
| `E_LEDGER_CORRUPT` | tracker | persisted ledger unreadable — refuses to guess |

## Integration seam (provider bridge — P11)

The L2 provider bridge is `server/src/providers/` (per
`providers/README.md:3`). The natural hook points, verified by the probe
at runtime (file:line drift makes the probe FAIL):

- `server/src/providers/runtime/LLMClient.js` — `generateContent()`
  already gates spend BEFORE the walk:
  `opts.budget && typeof opts.budget.canSpend === 'function'` → throw
  `Budget exhausted` (Phase 1 request-economy precedent). `caps.check`
  is the spend-aware evolution of exactly that gate.
- Same file — the per-model-call dispatch
  (`text = await call(prompt, system, imageBase64, opts, errors)`) and
  the tool-loop wrapper `chatWithToolsOnce()`: a pre-call
  `caps.check({ sessionId, providerId, spendUsd: ledgerTotal +
  estimateCost(request), budgetUsd })` throws before the network call
  when `state === 'cap'`; a post-call
  `caps.record({ sessionId, providerId, usd })` ledgers the real usage
  cost.
- `server/src/providers/adapters/chatClientBase.js` — `chat(request)` is
  the adapter-level choke point every vendor adapter flows through.

Wiring requires editing `server/src/**` → **zone-owner task**. Session
identity (`opts.sessionId`) does not exist in the bridge opts yet — that
plumbing is part of the same zone-owner wiring.

## Probe map (scripts/phase9-e-probe.mjs)

| Case | Proves |
|------|--------|
| p1 | fresh session → `ok`, pct 0, remaining = budget |
| p2 | record 0.80/1.00 → `warn` at exactly 80%, remaining 0.20 |
| p3 | more spend in warn band → no SECOND warning event |
| p4 | total reaches 1.00 → `cap`, terminated flag set |
| p5 | post-cap `record()` → `E_SESSION_CAPPED` + attempt logged |
| p6 | s1 capped, s2 fresh → s2 `ok` (no cap leakage) |
| p7 | per-provider ledger: providerA 0.60 + providerB 0.40 = 1.00 |
| p8 | `reset('s1')` → fresh `ok`; `reset()` clears all |
| p9 | custom thresholds warn=0.5 cap=0.75 fire at 50% / 75% |
| p10a/b | determinism + persistence across two REAL processes + raw ledger file |
| p11 | runtime-verified bridge citations (file:line) + wiring shape |
