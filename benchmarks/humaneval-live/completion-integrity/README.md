# Completion-integrity harness (M16 Phase 3)

Isolates the M15 evidence-grounded completion gate from model quality. Each
scenario scripts an assistant transcript and drives it through the **real**
`runTaskWithJexi` → `AgentLoop` path — the same path `benchmarks/humaneval-live`
measures — against a loopback, OpenAI-compatible provider that speaks SSE.

The provider is `mock-provider.mjs`: `POST /control/script { rounds: [...] }`
queues assistant rounds; the round is chosen by how many `tool` messages have
been fed back, so a scenario is a plain ordered list. `GET /control/state`
returns what was served.

## Run

```bash
MODEL_PROVIDER=ollama node run-all.mjs            # all scenarios
MODEL_PROVIDER=ollama node scenario.mjs write     # one scenario, JSON on stdout
```

Each scenario runs in its own process: `runTaskWithJexi` mutates
`process.env.WORKSPACE_DIR` and `AgentLoop` keeps one global turn, so a shared
process lets an orphaned loop from a timed-out scenario write into the next
scenario's sandbox.

## Scenarios

| scenario | asserts |
|----------|---------|
| `write` | a lone edit is honestly `unverified` (no passing verification) |
| `claim-no-tool` | a claim with no tool call is `unverified` |
| `failed-write` | an escaping write fails, no file lands, `unverified` |
| `write-then-test` | write + a `term_execute` check; `unverified` |
| `all-fail` | a failing read leaves no file; `unverified` |
| `dead-provider` | provider 500s degrade honestly, no crash |
| `test-run-verified` | write + a **green `test_run`** ⇒ **verified** |

`test-run-verified` is the defect detector for M16 finding D1: on the M15
commit it FAILS, because `executeTool` returns its result as a formatted
string, so `AgentLoop`'s `r.result.status === 'pass'` branch is dead code and a
green suite can never satisfy the gate. See `docs/M16-READINESS.md`.
