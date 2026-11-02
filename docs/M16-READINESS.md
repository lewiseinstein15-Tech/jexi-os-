# M16 — JEXI Final Benchmark Qualification

Mission: decide whether JEXI is ready for the head-to-head GOAT benchmark
against ARCEN. Repo `lewiseinstein15-Tech/jexi-os-`, branch `main`, base commit
`a490136ce4d939e3b13e9de1d68f5fead70a9b1f` (M15, "reliable tool execution +
evidence-grounded completion").

## Verdict

**NOT READY.**

The M15 milestone did not deliver what it claims: the completion gate it added
can never be satisfied, so a correct, tested coding turn is still reported
`[UNVERIFIED]`. On top of that, the benchmark is **not reproducible** — five
runs of the same 15 tasks at the same settings produced 8, 2, 1, 9 and (fresh
slice) 0 passes. A benchmark that cannot be reproduced cannot qualify anything
for a head-to-head.

Neither finding is fixed in this mission — M16 is a qualification. All numbers
below are reproducible from the commands at the end.

## Finding D1 — a green test run cannot verify a turn (blocking)

**Symptom.** `fs_write` then `test_run` (suite genuinely green) still yields
`unverified`, reason `0 diagnostics`, answer annotated `[UNVERIFIED]`.

**Root cause.** The M15 gate reads a structured field off the tool result, but
`executeTool` returns the result as a **formatted string**.

- `server/src/services/AgentLoop.js:393`
  `const isPassingTest = TEST_TOOLS.has(call.name) && r.ok && r.result && r.result.status === 'pass';`
  → `r.result` is a string, so `r.result.status` is `undefined`; dead branch.
- `server/src/services/AgentLoop.js:388`
  `if (r.ok && r.result && typeof r.result === 'object' && TEST_TOOLS.has(call.name))`
  → never true for the same reason, so `noteTestResult` is never called and
  `readTestVerdict` (`server/src/services/agent/test-verdict.js`) never sees a
  real verdict.
- `server/src/services/ToolRuntime.js:1969`
  `const ok = { ok: true, tool: slug, permission: perm, tier, result: finalText, ... }`
  where `finalText = formatResult(result)` — a string. The structured
  `{ status, exitCode, passed, failed }` the testing engines produce is
  flattened before it reaches the loop.

**Consequence.** `CodingLoop.editSeen` is set by any successful mutating call,
so the `editSeen && !verified` branch always fires. The only other route to
`verified` is `coding.verify(...)`, and in a bare benchmark sandbox that route
is itself unreachable:

```
verifyAfterEdit(real:['lint','unit']) in a fresh sandbox:
  unit  => error  (no test command configured)
  lint  => fail   ("0 diagnostics"; eslint exits 2 "No files matching src")
  build => error  (no build command configured)
```

So in the benchmark environment a coding turn is **unverifiable by
construction**; `verified` / `canClaimSuccess: true` cannot be reached.

**Secondary.** `LintVerifier` maps any nonzero exit to `fail` even with zero
parsed diagnostics (`server/src/verification/verifiers/LintVerifier.js`:
`const pass = res.ok && diagnostics === 0;`). A runner error ("no files matching
the pattern src", a missing config) is reported as `0 diagnostics`, which reads
as "the code has problems" when nothing was linted.

**The model notices.** On HumanEval/9 the agent's own answer says: *"The ESLint
verification error is unrelated to the Python code — it's a JS linter looking
for a 'src' pattern in a different sandbox."* The false-fail is visible to the
model under test.

**Why the M15 suite is green.** `server/tests/agi/test-m15-reliability.js`
asserts the gate against `CodingLoop` with injected seams
(`runVerify: async () => ({ ok: true })`, hand-built `noteToolCall` calls). No
test feeds a real `executeTool` return value into `noteTestResult`, so the
string-vs-object mismatch is invisible. 26/26 pass on this commit.

## Finding D2 — the benchmark is not reproducible (blocking)

Five runs, identical dataset (sha256
`094a17ace7a536483e83cd6bb0348c9df1e2bb532ff4e09961665a8b9414c157`), identical
model (`llama3.2:3b`, recorded in every manifest), identical prompt:

| run | config | pass |
|-----|--------|------|
| b1 | `--timeout 150` | 8/15 |
| b2 | `--timeout 150` | 2/15 |
| bench3 | `--timeout 300`, CPU-contended | 1/15 |
| bench4 | `--timeout 300`, clean | 9/15 |
| slice 9–14 | `--timeout 300`, fresh process | 0/6 |

Gold leg (canonical solutions) is 15/15, so the dataset and grader are sound.

**Two distinct failure mechanisms, both visible in the data:**

1. *Truncation at the timeout cap.* b2's six disagreements with b1 are exactly
   the six rows whose `durationMs >= 150000`. The repo's own `RESULTS.md`
   documents that the benchmark needs `--timeout 300`; b1/b2 used the 150 s
   default. This part is a measurement error, not an agent regression.

2. *A late collapse to zero tool calls.* bench4 ran clean and passed tasks
   0–8 (9/9), then failed 9–14 with **zero tool calls and no `agentError`**.
   bench3 showed the same shape. The position is different each run, and a
   fresh process on tasks 9–14 still returned 0/6 — so it is neither task
   difficulty nor position alone, and it is not the model server: a direct
   `api/generate` probe returned correct code in 17 tokens. The signature —
   intermittent, run-dependent, always "model emitted no tool call and looped
   until timeout" — points at cross-task state or provider routing inside the
   single long-lived benchmark process. `LLMClient` has a keyless network
   ladder (`server/src/providers/runtime/LLMClient.js`, Pollinations/Kilo) that
   engages when the primary provider fails; a silent substitution mid-run would
   produce exactly this. **Unconfirmed — flagged for the next mission.**

**Consequence for qualification.** At the time of writing, task 9 fails 3/3
where b1/b2 passed it. Without run-to-run determinism, no pass-rate can be
attributed to JEXI rather than to run conditions, and no head-to-head result
would be defensible.

## Finding D3 — the harness can report PASS on a timed-out task

bench4 HumanEval/3 is recorded `pass=True` with
`agentError="agent loop timed out after 300000ms"` and only 1 tool call. The
grader reads `solution.py` and ignores `agentInfo.error`; a timed-out task that
happened to leave a passing file is scored as a pass. This inflates every
timed-out run and should be reconciled before any comparison.

## What *does* work

The M15 *honesty* half is sound. The Phase-3 completion-integrity harness
(scripted SSE provider, real `AgentLoop`, fresh process per scenario) confirms:

| scenario | behaviour | result |
|----------|-----------|--------|
| `write` | lone edit honestly `unverified` | PASS |
| `claim-no-tool` | a claim with no tool call is `unverified` | PASS |
| `failed-write` | escaping write fails, no file, `unverified` | PASS |
| `write-then-test` | write + `term_execute`; `unverified` | PASS |
| `all-fail` | failing read, no file, `unverified` | PASS |
| `dead-provider` | primary provider 500s → honest failure | PASS |
| `test-run-verified` | green `test_run` ⇒ `verified` | **FAIL (D1)** |

A turn that cannot show real evidence never claims success, and a dead primary
provider degrades honestly rather than crashing.

## Recommendation

Do not enter the head-to-head. Minimum bar before re-qualification:

1. Fix D1 — carry the structured engine result alongside the formatted text
   (a non-model-facing field in `ToolRuntime`), and add a test that drives a
   real `test_run` through `runToolCalls` and asserts `gate.status === 'verified'`.
2. Make `LintVerifier` distinguish "ran, zero diagnostics" from "runner error",
   and scope it to the edited files instead of a bare `src`.
3. Fix D2 — make the benchmark deterministic: reuse the per-task process
   isolation that the Phase-3 harness needed, and record the provider that
   actually served each task so a mid-run ladder slide is visible.
4. Fix D3 — a timed-out task must not be scored `pass`.

## Reproduction

```bash
# benchmark (note --timeout 300; the 150s default truncates mid-task)
export DOTENV_CONFIG_QUIET=true MODEL_PROVIDER=ollama \
       OLLAMA_HOST=http://127.0.0.1:11434 MODEL_NAME=llama3.2:3b BENCH_MODEL=llama3.2:3b
node benchmarks/humaneval-live/run.mjs --leg jexi --tasks 15 --timeout 300 \
     --schema as-shipped --profile full

# run an arbitrary task slice in a fresh process (position vs difficulty)
node benchmarks/humaneval-live/slice.mjs --start 9 --end 15 --timeout 300

# phase-3 completion-integrity harness (scripted SSE provider, real AgentLoop)
MODEL_PROVIDER=ollama node benchmarks/humaneval-live/completion-integrity/run-all.mjs

# the M15 suite does not cover D1 (26/26 green on the failing commit)
node --test server/tests/agi/test-m15-reliability.js
```

## Artifacts

- `results/humaneval-jexi-as-shipped-2026-11-02T00-03-29-005Z.json` (8/15, b1)
- `results/humaneval-jexi-as-shipped-2026-11-02T00-39-43-885Z.json` (2/15, b2)
- `results/humaneval-jexi-as-shipped-2026-11-02T01-34-46-641Z.json` (1/15, bench3, contended)
- `results/humaneval-jexi-as-shipped-2026-11-02T02-12-21-168Z.json` (9/15, bench4, clean)
- `results/humaneval-gold-documented-2026-11-02T00-39-32-500Z.json` (15/15 gold)
- `completion-integrity/` — Phase-3 harness (mock provider + scenarios + runner)
- `slice.mjs` — arbitrary task-slice driver

M11/M12/M14/M15 artifacts and baselines are untouched; no tracked file from a
prior milestone was modified.
