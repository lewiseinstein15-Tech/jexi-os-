# Autonomous goals — Scope G

```js
import { createAutonomous } from './index.js';

const autonomous = createAutonomous({ sessionId: 'session-a' });
const { goalId } = autonomous.goal.set({
  description: 'Build the release candidate',
  maxTurns: 10,
  maxTokens: 100_000,
  maxWallMs: 60_000,
  gateCommand: 'npm run check', // optional
});

const result = await autonomous.continuation.run(goalId, async ({ turn }) => {
  // Do one real unit of work and report its measured token use.
  return turn === 1 ? { complete: true, tokens: 400, evidence: { checked: true } } : { tokens: 400 };
});
```

## Persistent goals

`createAutonomous()` stores one JSON record per `sessionId` in
`.jexi/autonomous/` by default. `goal.set`, `goal.get`, `goal.isComplete`,
`goal.complete`, and `goal.list` are scoped to that session. State writes use
an exclusive local lock, atomic replace, file fsync, and directory fsync.
A goal acknowledged by `set()` survives a subsequent process SIGKILL and can
be read by a fresh process. Interrupted writes and stale-lock recovery are not
claimed.

Goals default to `maxTurns: 10`, `maxTokens: 100000`, and `maxWallMs: 60000`.
A goal stays `active` when a continuation reaches a boundary, so a later
explicit run can resume it. A completed goal stores its evidence and cannot be
silently completed again with different evidence.

## Continuation boundaries

`continuation.run(goalId, taskRunner)` awaits one task result at a time. A
runner returns a string/`true`, or `{ complete: true, evidence, tokens }`, to
request completion. A non-completing runner can return `{ tokens }`. The
continuation checks wall time after awaited work, tokens after every report,
and turn count before starting another turn. A final gate receives only the remaining wall-time budget and cannot commit completion after that boundary. It returns one of:

- `goal-complete`
- `max-turns`
- `max-tokens`
- `max-wall-ms`
- `gate-failed`
- `error`

It never invokes a new turn after one of those boundaries wins. `turnsRun` is
the number of completed runner invocations, not a planned count. A runner that
is already executing cannot be preempted; wall time is checked immediately
when its awaited result returns.

## Gates and heartbeats

A goal with `gateCommand` runs that trusted local shell command before its
completion is committed. `gate.run(command)` runs a real subprocess and
returns `{ passed, exitCode, stdout, stderr, durationMs }`. Calling
`gate.run()` explicitly defaults to `npm run check`; a goal without a
`gateCommand` has no implicit gate, as the goal contract makes it optional.
Failed gates leave the goal active and produce `gate-failed` from continuation.

`heartbeat.schedule(goalId, { everyMs, maxPings? })` creates an in-process,
cron-style timer. `onFire(callback)` returns `{ unsubscribe() }`; `cancel()`
stops the next timer. Timer subscriptions do not survive process restart by
design; persistent goal state does.

`autonomousRuntime()` is a per-process singleton used by the slash commands
so a later `/heartbeat --cancel` reaches the same live timer. It is separate
from explicit `createAutonomous()` instances used by application code and
probes.

Scope G does not integrate server routes, RLM, harness, workgraph, or
subagent runtime state. Probe: `node scripts/phase10-g-probe.mjs` (Node 22).
