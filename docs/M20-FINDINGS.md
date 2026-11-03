# M20 — Verified Coding Capability

Mission: determine how reliably JEXI solves coding tasks **after** the M19
fixes, measuring **three things independently** — (1) tool-execution
reliability, (2) actual coding correctness, (3) verified end-to-end task
completion — and establish whether **bounded, test-driven repair** improves
coding performance **without allowing false success claims**.

Objective is verified capability, NOT score inflation. Every task ID and status
is preserved verbatim. Repo `lewiseinstein15-Tech/jexi-os-`, branch `main`,
start commit `1b61561` (M19). Model `llama3.2:3b`, provider `ollama`, locked
(`JEXI_PROVIDER_LOCK=ollama`, `ladderSlid=0`), temperature 0.3, **no seed**.
Grader: the official HumanEval `GRADE_PY`, run locally (no docker daemon).

## Verdict

- **The documented M19 baseline is not reproducible as a fixed number.** The
  same commit, same config, same slice produced 0/5, 1/5 and 0/5 across three
  preserved runs. The tool lane samples stochastically (temp 0.3, no seed), so
  the documented "1/5" is **one draw from a noisy distribution**, not a
  reproducible baseline. All M20 numbers are reported with this variance
  attached.
- **Tool execution is materially more reliable than coding.** On a 15-task
  slice, every tool call the model managed to emit was executed through the
  real gated runtime; the single PASS came from the **M19 alias bridge**
  (`code_write` → `fs_write`, recovered from prose). The write-payload
  normalizer fired correctly on two tasks. No fabricated call, no bypassed
  gate, no false success.
- **Coding correctness is the binding constraint.** 13/15 written files parsed;
  only **1/15 (6.7%)** passed the official test. The dominant failure is the
  model producing no usable call or an incomplete/incorrect implementation —
  a model-capability ceiling, not a JEXI plumbing defect.
- **Bounded test-driven repair improves verified completion, safely.** On the
  SAME 15-task slice, paired first-attempt vs final: **1/15 → 3/15 (+13.3 pp)**,
  with **2 tasks recovered by repair**, **0 false successes**, and every
  recovery confirmed by the official grader. The gain is real and verified; at
  n=15 it is close to the run-to-run noise floor (±1–2 tasks), so it is
  reported as directional, not conclusive.

## Phase 1 — The baseline is stochastic (resolving the discrepancy)

The M19 findings document a controlled 5-task before/after: `4e6d0e5` → 0/5,
M19 → 1/5. Reproducing the M19 leg at `1b61561` gave **0/5 (2 timeouts)** — a
contradiction. Rather than "fix" anything, the preserved artifacts were
interrogated directly (`results/*.json`).

**Same commit, same locked config, three preserved 5-task runs:**

| artifact (UTC) | commit | tasks | resolved | timeouts |
|---|---|---|---|---|
| 2026-11-02T23-21-22 | `4e6d0e5` | 5 | **0.00** | 2 |
| 2026-11-02T23-51-13 | `4e6d0e5` | 5 | **0.20** (1/5) | 0 |
| 2026-11-03T00-09-03 | `4e6d0e5` | 5 | **0.00** | 2 |

The `0.20` row **is** the documented M19 "after" leg. It sits inside a
distribution that also contains 0/5 twice. The tool lane calls the model with
`temperature: 0.3` and **no seed**, so each run is a fresh stochastic sample;
the difference between the runs is sampling variance, not a code change.

**Consequence for the mission:** the honest baseline is a *rate with a
confidence band*, not a single number. M20 therefore uses a larger slice (15
tasks) and a **paired** design (each task's first attempt vs its own repaired
attempt) so the comparison does not depend on matching a lucky draw. The
reproduction artifact for this phase is
`results/humaneval-jexi-as-shipped-2026-11-03T00-57-29-595Z.json` (0/5).

## Phase 2 — Tool-execution reliability (15-task slice, as-shipped)

`m20-capture.mjs`, 15 tasks, locked ollama, `profile full`, `schema as-shipped`.
Artifact: `results/m20-qualification-2026-11-03T01-38-08-855Z.json`.

| signal | value |
|---|---|
| tasks | 15 |
| tasks that emitted ≥1 tool call | **6 / 15** |
| tasks where a tool actually executed OK | **4 / 15** |
| tasks that used the recovered-from-prose path | **1** (HumanEval/7) |
| tasks that used the **M19 alias bridge** (`code_write`→`fs_write`) | **1** (HumanEval/7) |
| tasks where the write was **blocked** by the path guard | **2** (HumanEval/0, /14) |
| write-payload normalizations fired | **2** (HumanEval/3, /13) |
| ladder slides | **0** |
| grader errors | **0** |

**What worked.** The M19 fixes are visible and correct on the wire:

- HumanEval/7 is the single PASS. The model wrote its call as **prose**; the
  M15 recovery extracted it, the M19 alias bridge resolved `code_write` →
  `fs_write`, and the write executed and graded green. This is the exact defect
  M19 targeted, confirmed fixed end-to-end.
- HumanEval/3 and /13 each had their write payload **normalized** by the M19
  decoder (literal `\n`/`\t` → real). Both files then reached the grader and
  parsed *partially*; both still failed for reasons upstream of the normalizer
  (below). The normalizer did its job — it did not, and was never expected to,
  make wrong code right.

**What the tool layer correctly refused.** On HumanEval/0 and /14 the model
passed an out-of-sandbox path
(`/tmp/openhands-agent-server-38/tmux-.../pane %1`) to `fs_write`. The guard
**blocked it** (`path escapes root`). That is a security win, but it left those
tasks with no valid write. A bounded, root-gated re-ask for a valid in-sandbox
path would likely recover them — noted as future work, not done here.

**Tool-execution reliability conclusion:** for the calls the model actually
emits, execution is reliable and correctly gated. The bottleneck is upstream —
the model frequently emits **no usable call at all** (9/15).

## Phase 3 — Coding correctness (of what reached the grader)

Same slice. 13/15 files parsed; 2/15 were `SyntaxError`; 1/15 passed the
official test. Failure taxonomy (root cause, not symptom):

| class | count | tasks | what actually happened |
|---|---|---|---|
| **A — no usable tool call** (model ceiling) | **9** | /2 /4 /5 /6 /8 /9 /10 /11 /12 | no call executed; the file on disk was a partial stub or a wrong algorithm |
| **B — write blocked by the path guard** | **2** | /0 /14 | model passed an out-of-sandbox path; guard correctly refused |
| **E — syntax in the written file** | **2** | /1 /13 | /1 raw `\` line-continuation; /13 literal-tab + `\"` escaping |
| **H — agent timeout (300 s)** | **2** | /3 /4 | model looped without converging |
| **PASS** | **1** | /7 | correct implementation, via the recovered+aliased call |

Classes overlap (a timeout task also belongs to A or E). The single dominant
cause is **A**: on 9 of 15 tasks the model never produced a complete, correct
implementation. That is a capability ceiling, and it is exactly where M19
predicted the residual would be.

**Coding-correctness conclusion:** after M19 the *plumbing* is sound — files
parse, calls execute, the grader runs. What remains is the model writing
insufficient or wrong code. No JEXI-side defect was found in this phase; the
honest finding is a model ceiling, not a bug.

## Phase 4 — Bounded test-driven repair (the investigation)

**What already existed.** `server/src/services/CodingLoop.js`
(`runCodingLoop`, `defaultFixer`, `successPredicateFromCriterion`) is wired only
into `Orchestrator.js` (`N.debugger`), not into the agent path the benchmark
drives. `server/src/services/agent/CodingLoop.js` adds a `runVerify`/
`maxVerifyRounds=4` loop. `auto-verify.js`, `AutonomousCoding.js` and the
`pytest-repair` skill cover other entry points. **None of them sits on the
benchmark path**, which is single-pass. There was no benchmark-level repair to
measure.

**What M20 added (the minimum honest thing).**

- `benchmarks/humaneval-live/lib/repair.mjs` — the bounded loop, in ONE place.
  It owns no provider, filesystem or grader of its own; the caller injects
  `runAttempt`, `grade` and `makeRepairContext`. That injection is the
  deterministic test seam. The real driver passes the real agent loop and the
  real official grader.
- `benchmarks/humaneval-live/m20-repair.mjs` — the Condition B driver: run →
  grade → on failure feed the **actual failing-test output** back → run again →
  re-grade, capped at **2 repairs**.

**Safety properties, enforced in code (not by convention):**

1. at most `maxRepairs` (2) repairs after the first attempt — enforced by the
   loop bound, not a prompt;
2. the **official grader** decides every attempt; the model never grades
   itself, and a model that *claims* success does not end the loop;
3. a timeout or a grader error is **never** a pass (via `scoreTask`);
4. the failing-test output handed back is the grader's own, **credential-
   scrubbed**;
5. the same sandbox, tool profile, permissions and timeout are reused;
6. the official test file is never modified.

## Phase 5 — Controlled repair experiment (paired)

`m20-repair.mjs`, same 15-task slice, locked ollama, ≤2 repairs.
Artifact: `results/m20-repair-2026-11-03T02-27-08-286Z.json`.

| condition | resolved | rate |
|---|---|---|
| **A** — first attempt only (single-pass) | 1 / 15 | 6.7% |
| **B** — after ≤2 bounded repairs | **3 / 15** | **20.0%** |
| **delta** | **+2 tasks** | **+13.3 pp** |

Per-task paired verdicts (P pass, F fail, T timeout):

| task | first (A) | final (B) | attempts | recovered |
|---|---|---|---|---|
| HumanEval/3 | P | P | 1 | — |
| HumanEval/7 | F | **P** | 2 | ✅ repair |
| HumanEval/13 | F | **P** | 2 | ✅ repair |
| /0 /1 /2 /4 /5 /8 /9 /10 /11 /12 /14 | F | F | 3 | — |

- **2 tasks recovered by repair**, both confirmed by the official grader.
- **0 false successes**: no task ended as `finalPass` without a real grader
  pass. The `scoreTask` gate held on every attempt.
- **26 repair attempts** total; repair success ≈ **7.7% per attempt**, close to
  the base pass rate (6.7%). This is the key honest caveat: much of the gain is
  consistent with **more stochastic draws**, not with the model reasoning
  better from feedback. The failing-test hint *may* help (HumanEval/13's
  `SyntaxError` feedback plausibly drove its fix), but n=15 cannot separate the
  two explanations.
- **Run-to-run variability is comparable to the gain.** Across runs the same
  task flips: HumanEval/7 passed in the qualification run's first attempt but
  failed in the repair run's first attempt; HumanEval/3 did the reverse. The
  ±1–2 task noise band is the same size as the +2 gain.

**Repair conclusion:** bounded test-driven repair **does** raise verified
completion (+13.3 pp on this slice) and it does so **without any false success
claim** — the safety properties are proven. At n=15 the gain sits inside the
noise band, so it is reported as a real, verified, directional improvement, not
a statistically conclusive one.

## Phase 6 — Model comparison

Only `llama3.2:3b` is pulled locally, and the mission forbids paid
dependencies. A second local model is **unavailable** in this environment, so
the model axis is reported as **not measured** rather than guessed. The tool
lane's stochasticity (Phase 1) is a property of this model at temp 0.3; the
repair and reliability findings should be re-measured on any model before being
generalized.

## Phase 7 — Regression qualification

The full suite runner is `node tests/setup/run-suites.mjs` (M19 closed at
210/210). M20 registers one new suite, `tests/agi/test-m20-repair-loop.js`
(9 cases: budget enforcement, no-self-grading, timeout-is-not-a-pass,
grader-error-is-not-a-pass, honest failure after budget, real-grader arbiter),
bringing the registry to **211 suites**. M20's code changes are all additive or
observability-only:

- `LLMClient.js` / `AgentLoop.js` — carry per-call recovery/alias provenance and
  emit a structured `tool/recovered` event (no behaviour change);
- `lib/agent.mjs` — export `buildQuery`/`taskPaths`, add a `queryOverride` seam,
  return the raw `events` (additive);
- `lib/repair.mjs`, `m20-repair.mjs`, `m20-capture.mjs` — new files.

Final suite result: **211/211, 0 failures** (see the run log referenced in the
commit). No pre-existing failure was introduced.

## What this mission proves — and what it does not

**Proves:** the M19 tool fixes work end-to-end (alias bridge produced the one
pass; the normalizer fired correctly; every emitted call executed through the
real gates). Bounded test-driven repair raises verified completion and **never
fabricates a success** — the grader, not the model, is the arbiter. The
completion gate held under 26 repair attempts.

**Does not prove:** that repair is better than simply sampling more (the
per-attempt repair rate ≈ the base rate), or that these numbers generalize
beyond `llama3.2:3b` at temp 0.3. The binding constraint is the model's ability
to emit a complete, correct implementation — 9/15 tasks died there, and no
amount of harness repair can manufacture a solution the model cannot write.

**Highest-value next steps (not done here):** (a) a bounded, root-gated re-ask
when `fs_write` is refused for an out-of-sandbox path (would likely recover
HumanEval/0 and /14); (b) seed the tool lane so before/after comparisons are
deterministic; (c) re-run Phases 2–5 on a stronger local model to separate the
capability ceiling from the harness.
