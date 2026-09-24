# GSD — 5-phase loop with fresh context between phases

Ported from [`open-gsd/gsd-core`](https://github.com/open-gsd/gsd-core) @
`ccfed633551a7687ef3edb1774d6bd43ea34577b` (MIT).

GSD (Get Stuff Done) runs a task as five phases, each in a **fresh context
window**, so context rot cannot accumulate across a long task. The artifact is
the only channel between phases. This is what makes a long task survivable: no
phase depends on another phase's conversation, only on the file it left behind.

    discuss → plan → execute → verify → ship

| Phase   | Produces    | Consumes    | Upstream loop points                                        |
|---------|-------------|-------------|-------------------------------------------------------------|
| discuss | CONTEXT.md  | —           | `discuss:pre`, `discuss:post`                               |
| plan    | PLAN.md     | CONTEXT.md  | `plan:pre`, `plan:post`                                     |
| execute | SUMMARY.md  | PLAN.md     | `execute:pre`, `execute:wave:pre`, `execute:wave:post`, `execute:post` |
| verify  | UAT.md      | SUMMARY.md  | `verify:pre`, `verify:post`                                 |
| ship    | —           | UAT.md      | `ship:pre`, `ship:post`                                     |

`ship` declares no `produces` upstream; it is terminal. The loop closes there.

## API

```js
import { gsd, Gsd } from './workgraph/phases/gsd/index.js';

gsd.run(taskId, { input })   // -> { phase, artifacts, nextPhase? }
gsd.step(taskId)             // advance exactly one phase
gsd.status(taskId)           // -> { taskId, phase, donePhases, artifacts, shipped }
```

`opts.phase` pins a single phase (`{ phase: 'plan' }`), which is how a caller
advances one step and how an out-of-order request is expressed. `opts.root`
relocates the artifact store (default `<cwd>/.jexi/gsd`).

### Errors

| Code                | Raised when                                                    |
|---------------------|----------------------------------------------------------------|
| `E_UNKNOWN_TASK`    | taskId has no state directory (and cannot be created)          |
| `E_OUT_OF_ORDER`    | a declared input is absent, or the phase is not the next one   |
| `E_ALREADY_SHIPPED` | the loop already reached `ship`; it is terminal                |
| `E_SHIP_BLOCKED`    | `ship` ran but UAT.md is not `status: complete` / has failures |
| `E_UNKNOWN_PHASE`   | `opts.phase` names no phase                                    |

## Fresh-context guarantees

- **Disk is the only state.** `nextPhase` enumerates missing artifacts; there is
  no in-memory cursor and no per-task cache. A phase run in a brand-new process
  behaves identically to one run in this process.
- **Artifact read is the first action, write is the last.** `_runPhase` reads
  every declared `consumes` before building and writes `produces` after.
- **Writes are atomic.** `writeFileSync(tmp)` then `renameSync`, with stale
  `.tmp-*` debris swept on the next write. A SIGKILL mid-write leaves either the
  old bytes or the complete new bytes, never a truncated artifact. Verified over
  20 mid-write kills in the probe: 0 partial artifacts.
- **Deterministic.** Artifacts embed no timestamp, pid, or absolute path, so the
  same taskId + input yields byte-identical artifacts across runs and machines.
- **`ship` verifies before it ships.** A UAT recording non-passing results
  raises `E_SHIP_BLOCKED` rather than rendering a success record.

## STATE.md

Written after each phase as a cross-session observability record (upstream's
living memory). No phase consumes it and it does not drive ordering.

## Known limitation: argv input size

`opts.input` reaches the child processes through `process.argv` in the probe, so
inputs near `ARG_MAX` fail to spawn with `E2BIG`. The module itself takes input
as an ordinary argument and is unaffected; only an argv-passing driver hits this.
A driver passing large inputs should write them to a file and read them in the
child.

## Verification

```
node scripts/phase22-e-probe.mjs
```

Probes P1–P7: artifact-on-disk, cross-process handoff, single-input consumption,
full loop, SIGKILL resume + write atomicity, error codes, determinism hashes.