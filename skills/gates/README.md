# HARD GATES — executable, not advisory

A gate that doesn't block isn't a gate. Each module exports
`{ id, when(ctx), check(ctx) → Promise<{allowed, reason?, missing?, hint?}> }`.

## The integration point

`gated-dispatch.js` → `gatedDispatch(action, ctx)` — the single seam a
dispatch path calls **instead of** executing an action directly:

| Before this agent action…              | Gate that fires      | Trigger in ctx                    |
|----------------------------------------|----------------------|-----------------------------------|
| starting to plan                       | `brainstorming-gate` | `ctx.stage === 'plan'`            |
| writing code after planning            | `planning-gate`      | `ctx.stage === 'code'`            |
| writing production code                | `tdd-gate`           | `ctx.actionKind === 'production'` |
| merge / push                           | `review-gate`        | `ctx.action === 'push'|'merge'`   |

First `{allowed:false}` verdict → `action.run()` is never invoked;
verdict (allow AND block) recorded to the JSONL audit log
(`JEXI_GATE_AUDIT`, default `<os-tmpdir>/jexi-gate-audit.jsonl`).

## Server wiring note (honest scope statement)

The long-term home for the `gatedDispatch` call is the server dispatch
path (`server/src/services/` coding loop / commands dispatcher). That
directory is outside this scope's file zone (`skills/gates/**`), so this
module ships the seam + proves it by dispatching REAL file writes through
it in the Phase 12 Scope D probe. Wiring the server call site is a
one-line change for whoever owns that zone: replace `action.run(ctx)`
with `gatedDispatch(action, ctx)`.

## tdd-gate evidence rule

The gate does not trust `failingTest` claims — it **re-runs the command**
(`spawnSync`, 60s timeout) and requires a fresh non-zero exit it observed
itself. A passing test cannot license production code.
