# RLM kernel — Scope A

```js
import { PersistentRepl } from './index.js';
const repl = new PersistentRepl();
repl.eval('const x = 5; x * 3'); // { result: 15, output: '' }
repl.context.set('task', 'build');
repl.eval("context.get('task')"); // separate turn, same namespace
const checkpoint = repl.snapshot(); // JSON serializable
const resumed = PersistentRepl.restore(JSON.parse(JSON.stringify(checkpoint)));
resumed.eval('x'); // 5
```

Each instance owns a persistent VM lexical namespace (`const`/`let`/`var`
survive eval boundaries), context slot store and replay journal. `eval(code, ctx)`
provides per-call data as `ctx`; it is replaced each call. `context` inside the
VM exposes set/get/list. Slot values are copied JSON data, not host capabilities.
Missing slots return undefined; names are nonempty strings up to 256 characters.
`console.log/info/warn/error` become bounded `output` strings. Errors are
returned as `{ name, message }`. Synchronous cells default to a 1000ms timeout.

## Snapshot boundary (important)

Version 1 snapshots replay the ordered cell journal in a fresh VM, restoring
pre-cell slots and per-cell inputs, checking result/output/error observations,
and restoring the final named slots. This preserves deterministic synchronous
lexical variables, closures and mutations; the probe also restores in a separate
Node process. Snapshot creation validates replay immediately. Corrupted or
observably divergent replay throws `RLM_SNAPSHOT_REPLAY_DIVERGED`.

This is NOT arbitrary JavaScript heap serialization. Only deterministic,
side-effect-free synchronous cells are supported for restoration. Replay runs
code again. Do not put I/O, clocks, randomness, resource handles, external side
effects or async work in replayable cells. Hidden nondeterministic state is NOT
fully detectable by observation comparison. Snapshots contain executable code:
accept only trusted snapshots. Their format is not an authenticity signature.
Timeouts and non-JSON results taint snapshot eligibility and cause
`RLM_SNAPSHOT_UNSUPPORTED_STATE`. Unsupported context data is rejected.

`node:vm` is NOT a hostile-code sandbox. No filesystem, process, require, timers
or network API is intentionally injected, but this is not an isolation claim.
The future daemon/worker boundary must provide OS-level containment and async
host-call handling. Scope A is in-process, with restart demonstrated through
explicit snapshot serialization, not an automatic disk-backed daemon.

Run: `node scripts/phase10-a-probe.mjs` (Node 22).
No new dependencies or out-of-zone registration changes.
