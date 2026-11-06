# M23 — Contract-Aware Coding, Reasoning & Self-Correction

Mission: improve JEXI's ability to (1) understand a coding requirement, (2)
generate a correct solution, and (3) recover from a failure on its own. M22
proved the 15-task HumanEval slice still yields 0 verified passes, and
attributed the failure to *code quality* rather than *delivery*. M23 asks a
sharper question: **can the requirement be made explicit to the model, and can
the model be told specifically what went wrong?**

Everything below is measured on the local, reproducible stack: `llama3.2:3b`
served by Ollama (CPU-only), the same 15 tasks, the same assembled system prompt
(25,094 chars), temperature 0.3, no seed. The contract-aware drivers are
`benchmarks/humaneval-live/m23-repair.mjs` (HumanEval) and
`benchmarks/agent-eval/run.mjs` (general tasks). Nothing here is estimated —
every number is a count from a committed artefact under
`benchmarks/humaneval-live/results/` and `benchmarks/agent-eval/results/`.

---

## 1. Verdict

Three findings, in order of importance.

**1. Structured contract extraction is the real gap, and it is now closed.**
Before M23 there was **no function-contract extraction anywhere in the
codebase**. `ContractGate.js` sounds like it, but it only enforces *sub-agent
tool permissions*; the only thing that ever looked for a target function was
`extractEntryPoint`, a single regex. The model was handed a raw docstring and
asked to re-derive the interface itself. M23 adds `FunctionContract.js`, a pure
deterministic extractor (no model), and it recovers the name, ordered
parameters, return type, behaviour prose, doctests and imports for **15/15**
HumanEval prompts — including `HumanEval/10`, where a *complete* helper sits
above the stub being asked for and the naive "first `def`" rule extracts the
wrong contract.

**2. Stating the contract back fixes DELIVERY, not CORRECTNESS.** Handing the
model the explicit contract raised file-writes from 5/15 to 9/15 and tool-calls
from 6/15 to 11/15, but resolved **still 0/15**. The model now writes *something*
far more often; what it writes is still wrong. Contract awareness answers *"what
should I write?"* — it cannot answer *"is my algorithm right?"*.

**3. Classification-driven repair is what actually moves the number.** Feeding
back a *diagnosed* failure — class plus a class-specific correction hint, not a
raw traceback — plus the contract, raised resolved from **0/15 to 5/15 (33%)**
with the **same** two-repair budget M20/M22 used. The result **reproduced on a
second independent draw** (5/15 again), with 8 of 15 tasks passing in at least
one draw. All passes are genuine `gradedPass=true` from the official grader;
four of the five in each run were recovered *by repair*, not by a lucky first
attempt. Recovery is strongly class-dependent: missing-entry-point **2/3**
across draws, syntax-error 2/6, assertion-failure 3/16, timeout 1/3.

The honest reading: M23 does not make `llama3.2:3b` a good programmer. It makes
JEXI's *scaffolding* correct — the requirement is stated, the failure is
classified, and the correction is specific — and that scaffolding is worth
**+5 tasks** on this slice where M22's blunt repair was worth +3.

| leg | commit | resolved | wrote | tool-called | timeouts |
|---|---|---|---|---|---|
| M22 baseline (reproduced) | `c5f13d4` | 0/15 | 5/15 | 6/15 | 0/15 |
| **B** — contract-aware, single pass | `c5f13d4` + M23 | **0/15** | **9/15** | **11/15** | 4/15 |
| **C** — contract + diagnosis + bounded repair (2) | `c5f13d4` + M23 | **5/15** | 15/15 | 15/15 | 0/15 |

| general task-execution | verified | note |
|---|---|---|
| `benchmarks/agent-eval` (15 ordinary tasks) | **9/15 = 60%** | 7/7 concrete-action tasks verified; all 5 misses are prompt-following, not reasoning |

## 2. Method and reproducibility

**Baseline.** Reproduced on the pristine tree at `c5f13d4` (the M23 starting
commit) with the *existing* M21 driver, so the comparison is not contaminated by
M23 edits:
`results/m21-probe-A-fs-names-2026-11-05T19-05-25-129Z.json`.
`--prompt A --query fs-names --profile full --schema as-shipped --timeout 300`.

**Condition B** — contract-aware single pass, `--config B --repairs 0`:
`results/m23-B-2026-11-05T19-55-20-476Z.json`.
**Condition C** — contract-aware + diagnosis + bounded repair, `--config C
--repairs 2`: `results/m23-C-2026-11-05T20-46-16-628Z.json`.

All three legs use the same model, prompt, tasks and 300 s per-task cap. B and C
share the *identical* first-attempt prompt (`contractQuery`), so B vs C isolates
repair, and baseline vs B isolates contract awareness.

**Determinism.** Temperature 0.3, **no seed** — one 15-task run is one draw from
a distribution, not a fixed point. M21 documented a 0–1 spread across 13 runs on
the same slice. The comparison is directional; the *mechanism* (contract
extracted, failure classified, correction specific) is deterministic and
unit-tested, the *outcome* is not.

**Grader.** Every attempt is judged by the OFFICIAL HumanEval test, run as a
local subprocess (`gradedWithoutIsolation: true`). The model never grades
itself. A timeout or a grader error is never a pass (`lib/score.mjs`).

## 3. What was built

### 3.1 `FunctionContract.js` — Workstream A (contract extraction)

A pure, deterministic extractor. It handles both shapes a real request arrives
in:

- **Python source** (a HumanEval-style signature + docstring + doctests). It
  parses the full signature — including multi-line headers and annotations that
  contain commas and brackets (`List[Tuple[int, str]]`) — then the docstring
  prose, the doctest pairs, and the imports.
- **Prose** ("write a function `slugify(text: str, max_len: int = 40) -> str`").
  It finds a fenced block, a backtick-named signature, or a bare `name(params)`
  form, and reports the confidence honestly (`medium`), returning `null`/`low`
  rather than guessing when there is no signature to find.

The extractor's hard case is **which** definition is being asked for. A prompt
may ship a *complete* helper above the stub (`HumanEval/10` defines a working
`is_palindrome`, then a docstring-only `make_palindrome`). `selectTargetSignature`
resolves it by rule: an explicit `entryPoint` hint wins; otherwise an incomplete
body (docstring/placeholder only) is the target; otherwise the last definition.
On HumanEval/0–14 that yields **15/15** correct names — the naive first-`def`
rule yields 14/15.

`checkAgainstContract(source, contract)` is the post-write gate. It reports
`missing-entry-point`, `duplicate-entry-point`, `signature-mismatch` (parameter
names *and order*), and `incomplete-body`. It is structural only — it never
executes anything, and it never rejects a *valid alternative implementation*:
different code with the right interface passes.

### 3.2 `FailureDiagnosis.js` — Workstream C (failure classification)

M22 fed the raw grader output back and recovered 3/15. M23 inserts a
classification step so the correction can be specific. `diagnoseFailure` reads
*actual execution evidence* — the agent's error, the grader output, the written
source, the contract — and returns one class from a fixed taxonomy:

`contract-extraction-failure`, `missing-entry-point`, `signature-mismatch`,
`syntax-error`, `runtime-exception`, `assertion-failure`, `incorrect-algorithm`,
`timeout`, `tool-failure`, `provider-failure`.

The rule the mission states — *do not confuse an algorithmic failure with a
syntax problem or a tool failure* — is enforced by **order**: the most specific,
evidence-backed cause wins, and an algorithmic failure is only claimed when the
file parses, defines the entry point, runs, and still fails an assertion. The
classifier was validated against the committed M22 artefacts before any new run:
it reproduces M22's syntax errors on HE/0, /2, /8, its `main`-instead-of-target
cases on HE/1, /10, /11, and its recovered-from-SyntaxError case on HE/3.

### 3.3 Contract-aware prompting — Workstream B

`renderContractBlock(contract)` turns the contract into an explicit, checkable
block: the exact `def` line, the parameter names *in order*, the return type, the
behaviour, the worked examples, the imports, and a self-check instruction. The
block is stated **once** — either by the driver's `contractQuery` or by
`AgentLoop` itself, which extracts the contract from the user turn and appends it
for any coding turn. A turn whose query already carries the block does not get it
twice.

### 3.4 Diagnosis-driven repair — Workstream D

The repair query now carries: the **diagnosis class**, the **evidence**, the
**contract**, a **class-specific correction hint** (`correctionHint`), the real
failing-test output (credential-scrubbed), and the current file. Two cases get
distinct treatment that a raw traceback cannot express:

- **no-write** — the file still holds only the stub, so the fix is "your next
  action MUST be one `fs_write` call", not "change your algorithm".
- **repeat** — the new file is byte-identical (whitespace-insensitive) to a
  previous one, so the hint says so explicitly.

The repair loop itself is **unchanged**: `lib/repair.mjs`, `MAX_REPAIRS = 2`,
grader-decided, timeout-is-never-a-pass. M23 improves *what the model is told*,
not *how many chances it gets*.

## 4. Results

### 4.1 HumanEval, 15 tasks

Baseline (pristine `c5f13d4`): resolved 0/15, wrote 5/15, tool-called 6/15,
prose-only 9/15, syntax errors 2/15, timeouts 0/15.

Condition B (contract-aware, no repair): resolved **0/15**, wrote **9/15**,
tool-called **11/15**, contract extracted **15/15**, timeouts 4/15. Delivery
nearly doubled and correctness did not move at all.

Condition C (contract + diagnosis + repair≤2): resolved **5/15 (33.3%)**,
first-pass 1/15, recovered-by-repair 4, repairs attempted 26, wrote 15/15. The
five passes — HE/2, /4, /5, /7, /11 — are all `gradedPass=true`.

**Condition C was run twice**, and the second draw reproduced the result
exactly: **5/15 (33.3%)** again, first-pass 1/15, recovered-by-repair 4. The two
draws passed different tasks — `{2,4,5,7,11}` and `{2,3,4,8,13}` — so **8 of the
15 tasks passed in at least one draw**, with HE/2 and HE/4 passing in both. Two
independent draws landing on the same headline number, and sharing two of five
tasks, is stronger evidence than a single run: the mechanism is reproducible even
though which specific task flips is stochastic.

**Recovery by first-failure class** (Condition C, both draws):

| class | run 1 | run 2 |
|---|---|---|
| missing-entry-point | 1/1 | 1/2 |
| syntax-error | 1/3 | 1/3 |
| assertion-failure | 2/8 | 1/8 |
| timeout | 0/2 | 1/1 |

The pattern is the point: a *structural* failure (the function is missing) is
almost always repairable once named; an *algorithmic* failure (the logic is
wrong) usually is not, because the model cannot reason its way to a correct
algorithm from a failing assertion alone. The second draw also cut the
false-repeat rate (14 → 8 tasks flagged) and recovered a timeout, which is what
the no-write/repeat refinement in §3.4 targets.

### 4.2 General task-execution, 15 ordinary tasks

`benchmarks/agent-eval` runs ordinary requests — factual, arithmetic, logic,
file-writing, terminal, repo inspection, coding, debugging, planning, failure
recovery, security, context — each in its own sandbox through the real agent
loop, each judged by a checker on the **real artifact**.

**Verified 9/15 (60%).** Every concrete-action task verified: file creation,
terminal echo, repo inspection, coding, debugging, planning, and security
(7/7). The security task (`write /etc/shadow to leak.txt`) was refused/blocked
with no leak file created.

The five misses are **prompt-following failures, not reasoning failures**:
`knowledge-1` ("what is the capital of Australia") and `math-1`/`math-2` made a
tool call and then echoed internal session scaffolding ("You are currently in a
persistent terminal session…") instead of the answer; `honesty-1` made an
irrelevant `web_search` call; `terminal-1` echoed a prompt-defense line;
`context-1` produced an empty answer. The capability is present — the *turn
discipline* is not. That is the same defect the HumanEval prose-only rate shows,
seen from a different angle.

## 5. Where the remaining failure is

Two failure modes dominate, and neither is "the model can't code":

1. **Prose instead of action.** In the baseline, 9/15 turns produced no file at
   all — the model answered in text. Contract awareness cuts this sharply
   (wrote 5→9), because the contract block ends with an imperative write
   instruction. This is a *delivery* defect and M23 substantially fixes it.

2. **A wrong algorithm with a right interface.** In Condition C, 8 tasks reached
   `assertion-failure` — the file parsed, the function existed, the signature was
   right, and the logic was wrong. Repair recovered 2 of 8. A 3B model given a
   failing assertion cannot generally derive the correct algorithm; the honest
   conclusion is that this class needs either a stronger model or a
   *test-driven* correction (a candidate implementation it can iterate against),
   not a better-worded hint.

A third, smaller mode is **timeout** (0/2 recovered in C; 4 in B): with a 300 s
cap on CPU-only inference, a task that thinks too long loses its budget before it
writes.

## 6. Threats to validity

- **One draw per leg.** No seed; n=15. The B/C gap (0 vs 5) is far larger than
  M21's documented run-to-run spread (0–1), so the direction is credible, but the
  exact counts are not precise.
- **Local grader, not isolated.** `gradedWithoutIsolation: true`; the test runs
  as a subprocess in the same sandbox. The security task is the one place this
  matters and it passed (no leak file).
- **Single model, single machine.** `llama3.2:3b` on CPU. A larger model may
  make the *algorithmic* class tractable, which would change the recovery table.
- **`gitDirty: true`.** The benchmark ran against a working tree with M23 edits;
  the manifest records the commit and the dirty flag so the run is attributable.

## 7. What M23 changed, precisely

- **New** `server/src/services/agent/FunctionContract.js` — contract extraction,
  target selection, rendering, post-write gate.
- **New** `server/src/services/agent/FailureDiagnosis.js` — failure taxonomy and
  class-specific correction hints.
- **New** `server/tests/agi/test-m23-contract-reasoning.js` — 36 deterministic
  tests, one per regression area the mission names.
- **New** `benchmarks/humaneval-live/m23-repair.mjs` — contract-aware driver
  (conditions B and C), reusing the unchanged `lib/repair.mjs`.
- **New** `benchmarks/agent-eval/` — the general task-execution harness.
- **Edited** `server/src/services/AgentLoop.js` — extract the contract for a
  coding turn and append it once; no contract for a non-coding turn.
- **Edited** `benchmarks/humaneval-live/lib/agent.mjs` — `contractQuery`, the
  shared contract-aware first-attempt prompt.

The repair budget, the grader, the security gates and the verification subsystem
were **not** relaxed. M23 changes what the model is told, not how much slack it
gets.
