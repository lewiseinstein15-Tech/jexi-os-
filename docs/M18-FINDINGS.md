# M18 — Failure Attribution and Model Comparison

Mission: determine WHY JEXI scores 0/15 on the current HumanEval benchmark and
identify the smallest evidence-supported change to improve performance WITHOUT
compromising verification or honesty. Repo `lewiseinstein15-Tech/jexi-os-`,
branch `main`, start commit `cfc9581052abba48282ccbf0f3ce69834bbc7fbe` (M17).

Model `llama3.2:3b`, provider `ollama`, locked. M17 guarantees (209/209 suites,
7/7 completion-integrity scenarios) are the floor this mission must not break.

## Verdict

**0/15 is dominated by a model-capability ceiling, not a JEXI plumbing defect.**

Two thirds of the failures (10/15) are the model answering in prose and never
calling a tool, so the graded file is left as the untouched stub. A short probe
against the same Ollama endpoint shows `llama3.2:3b` emits a *native* tool call
only ~1 time in 3 on JEXI's real prompt, at temperature 0 and with
`tool_choice: 'required'`. A benchmark that needs a tool call on every one of 15
tasks therefore lands at 0 when the per-turn call rate is ~40%.

There IS one real, small JEXI-side defect with deterministic evidence: a
recovered/prose tool call whose `content` argument carries **literal `\n`** is
written to disk verbatim, producing a `SyntaxError`. Normalising it recovers
HumanEval/3. That is the smallest evidence-supported change; it is bounded to
about one task on this slice, and the honest headline is that no small JEXI
change lifts 0/15 much while the model misses 60% of its tool calls.

## Phase 1 — Baseline verification (locked)

| fact | value |
|------|-------|
| HEAD | `cfc9581052abba48282ccbf0f3ce69834bbc7fbe` (clean at run time; probes left it dirty) |
| dataset | `benchmarks/humaneval-live/dataset/humaneval-test.json` |
| dataset sha256 | `094a17ace7a536483e83cd6bb0348c9df1e2bb532ff4e09961665a8b9414c157` (matches manifest) |
| grader | local subprocess (no Docker daemon — manifest records `gradedWithoutIsolation: true`) |
| gold leg | **15/15 resolved**, `gradedGreen=15`, `graderErrors=0` — harness and grader are sound |
| locked jexi run | `results/humaneval-jexi-as-shipped-2026-11-02T14-17-06-281Z.json` |
| locked verdict | **0/15 resolved**, `timeouts=4`, `providerLock=ollama`, `ladderSlid=0`, `providersObserved=['ollama']` |
| M17 test suites | **209/209 suites pass** (repo summary; 2 known-failing subtests inside `jexi-016-019-structure.test.js` are pre-existing and documented in AGENTS.md) |
| M17 completion integrity | **7/7 scenarios pass** (re-run this mission) |

The gold leg proves the grader passes correct solutions; the locked run proves
JEXI's own output is what fails. `ladderSlid=0` rules out the M16 provider-slide
confound — every task was served by `ollama`, honestly recorded.

## Phase 2 — Failure attribution (15/15 rows)

Per-row evidence: number of tool calls, whether the written file contains
literal `\n` (two chars) or real newlines, whether the materialised stub was
left unchanged, and the grader's own output.

| task | calls | literal `\n` | real `\n` | stub unchanged | grader | timed out | category |
|------|-------|-------------|----------|----------------|--------|-----------|----------|
| 0  | 1 | 6  | 0  | no  | SyntaxError    | no  | **A** |
| 1  | 0 | 0  | 7  | yes | AssertionError | no  | **B** |
| 2  | 0 | 0  | 12 | yes | AssertionError | no  | **B** |
| 3  | 1 | 8  | 0  | no  | SyntaxError    | no  | **A** |
| 4  | 0 | 0  | 9  | yes | Traceback      | no  | **B** |
| 5  | 0 | 0  | 11 | yes | AssertionError | no  | **B** |
| 6  | 1 | 0  | 8  | rewritten | AssertionError | no  | **C** |
| 7  | 1 | 9  | 0  | no  | SyntaxError    | **yes** | **A** |
| 8  | 0 | 0  | 12 | yes | AssertionError | **yes** | **B** |
| 9  | 0 | 0  | 10 | yes | AssertionError | no  | **B** |
| 10 | 0 | 0  | 11 | yes | AssertionError | no  | **B** |
| 11 | 1 | 17 | 0  | no  | SyntaxError    | **yes** | **A** |
| 12 | 0 | 0  | 14 | yes | AssertionError | **yes** | **B** |
| 13 | 0 | 0  | 10 | yes | AssertionError | no  | **B** |
| 14 | 0 | 0  | 9  | yes | AssertionError | no  | **B** |

- **A — written, content double-escaped (4: 0, 3, 7, 11).** `fs_write` was
  called and succeeded, but `content` carries literal `\n`, so `grade.py` dies
  with `SyntaxError: unexpected character after line continuation character`.
  Parsed `content` of HumanEval/0: real newline `False`, literal `\n` `True`.
- **B — no tool call, stub unchanged (10: 1,2,4,5,8,9,10,12,13,14).** Zero
  tool calls; `solution.py` is byte-for-byte the materialised stub, so the
  grader runs the untouched skeleton and `check()` asserts.
- **C — written correctly, wrong algorithm (1: 6).** A genuine capability miss.

The 4 timeouts (7, 8, 11, 12) interleave with A and B and are a symptom of the
same no-call behaviour: a turn that never emits a call runs to the 300 s cap.

## Root cause — evidence

### R1. `llama3.2:3b` emits a native tool call only ~1/3 of the time

Probes against `http://127.0.0.1:11434/v1/chat/completions` with the exact
captured JEXI request (25,176-char system prompt, 1,018-char user prompt, 8 tool
schemas, ~7.5k tokens total):

| condition | native tool calls |
|-----------|-------------------|
| shipped shape (`tool_choice:auto`, temp 0.3) | 0 (prose) |
| `tool_choice: required`, temp 0.3 | 1 → `fs_write` |
| `tool_choice: required`, **temp 0** ×3 | 1, 0, 0 |
| bounded system prompt + `required`, temp 0.2 ×3 | 1, 0, 0 |
| short prompt (151 chars) + tools | 1 → `fs_write` |

The model *can* emit a call, but not reliably, and neither temperature 0 nor a
bounded prompt nor `tool_choice: required` makes it deterministic. When it does
not, it writes the call as prose whose tool name (`code_write`) is not in the
offered menu, so `recoverToolCallsFromText` correctly refuses it. This is the
M15 finding ("real `tool_calls` ~40%, call-as-text ~60%") reproduced under lock.

### R2. A recovered/prose call can carry double-escaped content

When a call IS produced, its `content` can carry literal `\n`. For HumanEval/3
the written text is the **correct** `below_zero` implementation — only the
newlines are literal. Grading the escape-normalised text passes; grading the
raw text raises `SyntaxError`. `fs_write` writes the string verbatim, so the
corruption reaches disk.

### R3. Ollama's OpenAI `/v1` lane caps the prompt at ~2050 tokens

Measured: `/v1/chat/completions` evaluates 2050 prompt tokens regardless of
`options.num_ctx`, top-level `num_ctx`, or the loaded context size, while the
native `/api/chat` honours `options.num_ctx` (7220 for the same request). The
user task message survives the drop (a codeword in it is reproduced), but the
middle of the 25k system prompt is discarded. This is a real defect but is NOT
the dominant cause — a bounded prompt still produced prose in 2/3 probes.

## Model comparison — the decisive contrast

Two `as-shipped`, `--schema as-shipped`, `profile=full`, 15-task runs exist on
commit `cfc9581`:

| run | provider lock | served by | result | notes |
|-----|---------------|-----------|--------|-------|
| `14-17-06` | `ollama` | `ollama` ×15 | **0/15** | 4 timeouts, 10 no-call, 4 double-escaped |
| `13-45-25` | none (ladder) | `kilo` ×11, `ollama` ×4 | **11/15** | 0 timeouts, 0 agent errors |

In the kilo-served run every resolved task made 6–9 native tool calls and wrote
real newlines; the 4 tasks that slid to `ollama` all failed, three of them with
the same literal-`\n` corruption (2, 13, 18 literal `\n`). The ladder slid
because `JEXI_PROVIDER_LOCK` was unset, so `kilo-auto/free` (keyless, remote)
led and was never cooldowned.

This isolates the variable cleanly: **same prompt, same tools, same gate —
different model → 0/15 vs 11/15.** The plumbing is not the bottleneck; the
local 3B model's tool-calling reliability is.

## Smallest evidence-supported change

**Normalise escaped newlines in the `content` of a file-write tool call before
it is written.** Concretely, in the tool-call path, convert literal `\n` / `\t`
sequences to real characters for `fs_write` content (and equivalent write
tools) when the payload is a recovered/prose call.

- Evidence: `HumanEval/3` grades `PASS` after normalisation and `FAIL` before;
  it removes the Category A `SyntaxError` class (4/15 rows) deterministically.
- Bounded: it touches only the write payload, not verification, the completion
  gate, the risk profile, or the scoring reconciliation. The M17 guarantees are
  untouched — a recovered call still executes through the same gated
  `executeTool` path.
- Honest limit: it does not address Category B, which is 10/15 and is the model
  missing its tool call. It therefore lifts 0/15 to about 1/15 on this slice.

**Higher-impact follow-up (not "smallest"):** make the first tool round
mandatory and retry a no-call turn with `tool_choice: 'required'` (bounded, two
attempts). Converting a ~40% per-attempt call rate into ~1−(0.6)² ≈ 64% would
move Category B far more than any escaping fix, but the probe data shows it is
a probabilistic improvement, not a deterministic one, and it must be gated so
multi-round answers can still terminate.

## Reproducible commands

```bash
# gold leg — proves the harness and grader
node benchmarks/humaneval-live/run.mjs --leg gold --tasks 15

# locked jexi run (the 0/15 baseline)
JEXI_PROVIDER_LOCK=ollama MODEL_PROVIDER=ollama BENCH_MODEL=llama3.2:3b \
  node benchmarks/humaneval-live/run.mjs --leg jexi --tasks 15 --schema as-shipped

# unlocked run (the 11/15 kilo contrast)
MODEL_PROVIDER=ollama BENCH_MODEL=llama3.2:3b \
  node benchmarks/humaneval-live/run.mjs --leg jexi --tasks 15 --schema as-shipped

# M17 guarantees
cd server && npm test
DOTENV_CONFIG_QUIET=true MODEL_PROVIDER=ollama \
  node benchmarks/humaneval-live/completion-integrity/run-all.mjs
```
