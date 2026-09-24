# RLM daemon — Scope D

Linux/Node 22 implementation. One detached supervisor per explicitly owned cache
directory, real forked worker per open root session, private Unix-domain HTTP
socket for short-lived client requests. No server/events/kernel/harness edits.

```js
import { createDaemon } from './index.js';
const daemon = createDaemon();
await daemon.start(); // {pid, endpoint, startedAt}; discovers an existing owner
await daemon.open('A');
await daemon.eval('A', "const x = 5; context.set('task', 'build')");
await daemon.detach('A');
await daemon.attach('A');
await daemon.eval('A', 'x');
await daemon.listSessions();
// After externally SIGKILLing the supervisor:
await daemon.start();
await daemon.recover('A');
await daemon.stop();
```

The default export is a client with this API. `createDaemon({directory})` creates
another client/cache selection, not another live daemon until start. Extra methods
`open(id)` and `eval(id, code, ctx)` supply the session creation/execution operations
needed by the requested lifecycle. Workers own a root REPL; subagent tree topology
and the Scope E DAG store are not claimed here.

## Ownership and lifecycle

Default cache: `.jexi/rlm-daemon/` (already covered by `.jexi/` in .gitignore).
The directory is created mode 0700, socket and journals mode 0600. Existing cache
directories must already be trusted/private. No network TCP listener. HTTP client
connections close after each request; detach is a durable attachment event, never
an instruction to kill the worker. Attach checkpoints and retains its namespace.
A worker marked running means a live, admitted runtime, not constant CPU activity.
Inactive means no live worker. There is no idle eviction policy in this scope.

`owner.json` identifies the supervisor. Linux /proc is used to distinguish dead
and zombie owners from live owners during discovery. A live owner without a ready
socket returns E_DAEMON_STARTING rather than spawning a duplicate. The socket is
removed only after detecting a dead owner. Parallel first-start contenders may
receive an exclusive-lock error and retry; exactly one owns the cache.

A crashed worker marks only its session inactive and logs worker.died. Workers
exit on IPC disconnect if the daemon is killed, avoiding orphan runtimes. On
restart, the supervisor reconstructs session metadata and latest checkpoint from
the append-only journal; sessions start inactive until explicitly recovered.
Clean stop terminates workers, appends session.closed for each still-open session,
then removes endpoint and owner file. Closed sessions cannot be recovered or
reopened under the same ID. Journals are retained.

## Durability and event meanings

Each line is `{seq,ts,sessionId,kind,payload}`. A single supervisor serializes
mutating requests; every event is appended and fsynced. Successful eval replies
follow their checkpoint append. Unsupported Scope A snapshots fail the operation
and restore the prior runtime snapshot. Recovery executes only Scope A's supported
deterministic synchronous replay, not arbitrary side effects or async tasks.
Journal tails must be complete; torn lines fail closed, not silently discarded.

Event semantics for the specified P1–P7 sequence:
- session.opened / worker.spawned: initial admission of each session (two each).
- checkpoint: full Scope A snapshot at open, successful eval, detach and attach.
- session.detached / session.attached: client lifecycle, not worker termination.
- worker.died: observed unexpected exit while a supervisor is alive (one for B).
- recovery.started / recovery.completed: checkpoint replay and the NEW recovered
  worker PID. Recovery uses this pair instead of an extra initial worker.spawned.
- session.closed: orderly logical closure, including inactive sessions (two).

Daemon SIGKILL prevents it logging its own death or observing orphan workers'
subsequent exits; do not infer such worker.died rows. Recovery events are the
explicit evidence of reconstruction. Clients must treat unacknowledged evals as
uncertain and not automatically retry side-effectful code.

## Limits / carry-forward

Trusted local clients only; neither socket filesystem permissions nor Node VM
is a hostile-code sandbox. OS resource quotas, authentication for shared-user
access, idle retention, automatic torn-tail repair, PID-reuse hardening and
power-loss testing are not implemented. Scope A's sync/replay limitations remain.
No heartbeat/autonomous scheduler, subagent messaging or cross-platform Windows
named-pipe support is claimed. Journal replay is linear and snapshots grow with
history. Kill/recovery and clean shutdown are verified with real processes by
`node scripts/phase10-d-probe.mjs`.
