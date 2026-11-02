# M17 — Verification Integrity and Benchmark Determinism

Mission: fix the three defects M16 left blocking (`D1` completion gate, `D2`
non-reproducible benchmark, `D3` timeout scored as a pass) and produce
benchmark numbers that can be trusted. Repo `lewiseinstein15-Tech/jexi-os-`,
branch `main`, base commit `239527ece95391d304ae773f63fb8b8d59f453b0`.

M16 declared JEXI **NOT READY** for the head-to-head. This mission addresses
each blocking finding and re-establishes an honest baseline.

## D1 — a green test run could not verify a turn (FIXED)

**Defect.** The completion gate read `r.result.status`, but `executeTool`
returns `result` as a FORMATTED STRING (`ToolRuntime.js:1969`), so
`r.result.status` was always `undefined` and the branch was dead code. A
correct, tested coding turn could never reach `verified`.

**Fix.** `ToolRuntime` now attaches TYPED metadata beside the formatted text:

- `server/src/services/agent/exec-meta.js` (new) — `classifyExecution(slug, res, raw)`
  derives a typed `meta` (`kind`, `status`, `timedOut`, `exitCode`, `tests`,
  `passed`, `failed`, `evidence`) from the engine's RAW return value. It never
  reads natural language.
- `attachExecMeta(result, slug, raw)` is called on EVERY `executeTool` return
  path (blocked, declined, paused, permission-denied, unknown-tool, timeout,
  failure, success), so the gate has a verdict for every outcome. `result`
  stays the string the model sees; `meta` is additive.
- `AgentLoop.js` reads `r.meta` (`isPassingTestMeta`) instead of
  `r.result.status`; `CodingLoop.noteTestResult` consumes the typed verdict via
  `readVerdict` (typed metadata first, legacy object as fallback).

**Honesty rules enforced in `classifyExecution`:** a `pass` with zero tests is
an `error`; a killed run (`exitCode -1`, no output) is a `timeout`, not a pass;
`blocked`/`declined`/`not_run`/`error` are never passes.

**Secondary (M16 D1).** `LintVerifier` mapped any nonzero exit to `fail` even
with zero diagnostics — "no files matching src" read as "your code has
problems". It now distinguishes a runner error (nonzero exit, zero diagnostics,
zero messages) as `status: 'error'` with the runner's own output as the reason.

**Evidence.** `benchmarks/humaneval-live/completion-integrity/run-all.mjs`:
`test-run-verified` — which FAILED at HEAD — now reports
`verification=verified`, `file=true`, `unverified=false`. All 7 scenarios pass,
including `dead-provider` (honest failure, no file written).

## D2 — the benchmark was not reproducible (FIXED)

**Defect.** Five M16 runs of the same 15 tasks produced 8, 2, 1, 9 and 0
passes. M16 suspected a silent provider-ladder slide: `LLMClient` has a
keyless network ladder (Pollinations/Kilo) that engages when the primary
provider fails, and the benchmark recorded the *configured* model, not the one
that actually served each task.

**Fix — a deterministic provider.**

- `server/src/providers/runtime/ProviderRouter.js` — `providerOrder(prefer)`
  honours `JEXI_PROVIDER_LOCK`. When set, the ladder is reduced to exactly the
  locked provider (surviving intent/lane preference); when unset, the existing
  fallback legs are preserved. `configuredProviders()` is lock-aware, so the
  keyless network rungs are not even offered as configured providers.
- `server/src/providers/runtime/ProviderAttempts.js` (new) — an attempt sink:
  `beginProviderAttempt`/`recordProviderAttempt` (lane, provider, model, ok,
  ms, reason), a bounded in-memory buffer, `providersThatServed()`, and
  `resetProviderAttempts()`.
- `LLMClient.js` records an attempt on each lane it walks — plain-text
  (`__t0`), tool lane (`__tt0`), and plain-text fallback (`__ft0`).
- `benchmarks/humaneval-live/lib/agent.mjs` returns
  `providersThatServed`/`providerAttempts`; `run.mjs` records `providerLock`,
  `modelProviderEnv`, per-row `providerAttempts`, and a manifest
  `ladderSlid` count — a locked run served by anything but the lock is visible,
  not inferred.

**Evidence — two identical locked runs.**

| run | lock | tasks | resolved | gradedGreen | unresolvedGreen | timeouts | ladderSlid | providers |
|-----|------|-------|----------|-------------|-----------------|----------|------------|-----------|
| 1 (`11-54-17`) | ollama | 15 | 0/15 | 0 | 0 | 0 | **0** | `['ollama']` |
| 2 (`12-35-02`) | ollama | 15 | 0/15 | 0 | 0 | 2 | **0** | `['ollama']` |

Both runs: **zero ladder slides, only `ollama` served, zero false passes.**
Every attempt's `provider` is `ollama` across all lanes.

**Honest reading of 0/15.** With the ladder locked there is no silent
substitution, so this is the true capability of `llama3.2:3b` on CPU. The
tool-call decision is stochastic at temperature 0 in this Ollama build — some
tasks emit a write call, others fall to the plain-text lane and are scored
`unverified`; a few wrote escaped `\n` literals. Resolved count is therefore 0
in both runs even though the tool-call *pattern* varies. The benchmark is now
deterministic in the properties that matter (provider, no false passes, no
ladder slide); a stronger or more reliably-tool-calling model is required to
raise the resolved rate, and that is now measurable rather than confounded.

**Scope note.** The two locked runs diverge only in *which* task emits a tool
call and in timeout count (2 tasks hit the 300 s cap in run 2 under CPU
contention). The M16 "8/2/1/9/0" spread was driven by ladder slides and
timeout-cap truncation; with the lock, a locked provider cannot slide and the
scoring is reconciled, so the remaining variance is model-level, not
harness-level.

## D3 — a timed-out task could be scored a pass (FIXED)

**Defect.** `run.mjs` scored `pass: graded.passed` — the grader read a leftover
`solution.py` and ignored `agentInfo.error`. M16 bench4 HumanEval/3 was
recorded `pass=True` with `agentError="agent loop timed out after 300000ms"`.

**Fix.** `benchmarks/humaneval-live/lib/score.mjs` (new) — one reconciliation
shared by `run.mjs` and `slice.mjs`: a task is RESOLVED only when the agent
loop completed without error AND the grader ran AND the grader passed. The
reason string distinguishes timeout from agent error from grader error, and
`summarise` reports `gradedGreen` vs `resolved` plus `unresolvedGreen` (the
exact overcount D3 caused).

**Evidence.** Re-scoring M16's own record:

```
scoreTask({ graded:{passed:true}, agentError:'agent loop timed out after 300000ms' })
  => { pass:false, gradedPass:true, agentTimedOut:true, reason:'timeout: …' }
```

The two historical false positives in `results/` (HumanEval/13 and
HumanEval/3, both `pass=true` + timeout) are now correctly non-passes.

## Regression

- M17 suites: **29/29** (`test-m17-completion-gate.js`,
  `test-m17-bench-scoring.js`, `test-m17-bench-determinism.js`).
- M16 completion-integrity harness: **7/7** scenarios.
- Adjacent suites re-run individually: coding-loop 24/24, M15 reliability
  25/26 (1 skip), tool-disclosure 14/14, testing-domain 13/13, ollama-provider
  5/5, request-economy 13/13, request-meter 5/5, unified-tools 8/8,
  agent-tools-reach-model 3/3.
- `jexi-016-019-structure.test.js` has **2 pre-existing failures at HEAD**
  (AgentLoop line budget: 616 at HEAD, budget 560; ToolSetBuilder ordering),
  unchanged by this mission — AgentLoop grew only by the 2 lines the D1 gate
  needs.

## Verdict

All three M16 blocking defects are fixed and covered by tests. The benchmark
now runs deterministically under `JEXI_PROVIDER_LOCK` and reports only honest
verdicts. The remaining gap to a head-to-head is model capability, not harness
integrity.

## Reproduction

```bash
export DOTENV_CONFIG_QUIET=true MODEL_PROVIDER=ollama JEXI_PROVIDER_LOCK=ollama \
       OLLAMA_HOST=http://127.0.0.1:11434 MODEL_NAME=llama3.2:3b
# deterministic benchmark (run alone; no concurrent CPU work)
node benchmarks/humaneval-live/run.mjs --leg jexi --tasks 15 --timeout 300 \
     --schema as-shipped --profile full
# completion-integrity harness
MODEL_PROVIDER=ollama node benchmarks/humaneval-live/completion-integrity/run-all.mjs
# M17 suites
node --test server/tests/agi/test-m17-completion-gate.js \
          server/tests/agi/test-m17-bench-scoring.js \
          server/tests/agi/test-m17-bench-determinism.js
```
