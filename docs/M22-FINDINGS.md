# M22 — Code-Generation Correctness & Structured Output

Mission: raise the *quality of generated code* on the 15-task HumanEval slice.
M21 fixed delivery (a call now reaches the file-writer); M22 asks whether the
bytes that land on disk are correct Python that solves the task.

Everything below is measured on the local, reproducible stack: `llama3.2:3b`
served by Ollama, the same 15 tasks, the same assembled system prompt
(25,094 chars), temperature 0.3, no seed. The runner is
`benchmarks/humaneval-live/m21-probe.mjs`; the classifier is
`benchmarks/humaneval-live/measure.mjs`. Nothing here is estimated — every
number is a count from a committed artefact under
`benchmarks/humaneval-live/results/`.

---

## 1. Verdict

The M21 result (0 verified passes) was reproduced on a pristine worktree of the
baseline commit, so the headline number was real and not an artefact of a dirty
tree. M22 improves delivery substantially and produces the first verified pass
in the sequence, but **the dominant remaining failure is code quality, not
delivery**: of the files the model writes, roughly half do not compile, and the
single most common defect is an **unterminated string literal** the model emits
when it stops mid-thought.

| run | commit | resolved | wrote | valid call | syntax-valid (of written) | prose-only | timeouts |
|---|---|---|---|---|---|---|---|
| M21 baseline | `43d518f` | 0/15 | 4/15 | 5/15 | 2/4 | 10/15 | 3/15 |
| M22 no-repair | `4ac7cba` + working tree | **1/15** | **9/15** | **9/15** | 4/9 | **6/15** | 4/15 |
| M22 bounded repair | `4ac7cba` + working tree | **3/15** | 11/15 | 15/15 | **8/11** | 0/15 | 0/15 |

The honest reading: M22 did **not** solve code quality in the no-repair path. It
moved the needle on delivery (wrote 4 → 9, valid call 5 → 9, prose-only 10 → 6)
and produced one pass, and it produced the *measurement* and the *evidence
capture* that make the code-quality failure attributable rather than mysterious.
The one intervention that does move code quality is bounded test-driven repair
(§8): with the real failing output fed back, the top defect disappears entirely
and resolved rises 0 → 3 of 15.

## 2. Method and reproducibility

Two legs, run on the same machine, same model, same prompt, same 15 tasks:

- **Baseline leg** — a `git worktree` pinned at `43d518f` (the M21 commit),
  so the comparison is not contaminated by M22 edits. Artifact:
  `results/m22-baseline-43d518f-A-fs-names-2026-11-05T13-19-21-617Z.json`.
- **M22 no-repair leg** — the working tree at `4ac7cba` plus the M22 changes
  (`emitFullToolArgs`). Artifact:
  `results/m21-probe-A-fs-names-2026-11-05T14-14-31-437Z.json`.

Both legs used `--profile full --schema as-shipped --prompt A --query fs-names`
and a 300 s per-task cap. The `fs-names` query names the tools that are actually
in the offered menu (`fs_write`, `term_execute`) instead of the generic
"code-write" phrasing the model cannot map to a slug.

**Determinism.** The stack is stochastic: temperature 0.3 and **no seed** (JEXI
never sets one). A single 15-task run is therefore one *draw* from a
distribution, not a fixed point. M21 documented a spread of 0–1 resolved across
13 runs. Both legs here are single draws and must be read that way; the paired
comparison is directional, not a controlled trial.

`AGENTS.md` records an earlier M22 draw (`wrote 3/15 → 10/15`). This document
records a later draw (`wrote 4/15 → 9/15`). The delivery counts differ because
the runs are different draws, not because either is wrong; the *direction* and
the *code-quality verdict* are identical in both. Where the two disagree on a
count, the number in this document is the one re-derivable from the committed
artefacts below.

**The classifier.** `measure.mjs` runs CPython's own `ast.parse` over each
task's final bytes, so "syntax-valid" means exactly what the interpreter means.
The AST metrics are computed **over written files only**: the harness seeds each
task with a valid Python stub, and counting an untouched stub as "syntax-valid"
would report a high rate for a run that wrote nothing. The metric table prints
the denominator (`4/9`, not `13/15`) so the rate cannot be misread.

## 3. Baseline (M21 at `43d518f`)

```
resolved 0/15 = 0.0%
wrote=4 validToolCallTasks=5 toolExecuted=5 timeouts=3 syntaxErrors=2 proseOnly=10
```

The baseline reproduced the M21 headline exactly: zero verified passes, ten of
fifteen tasks left as prose with no write at all. This confirms the M21 result
was not a dirty-tree artefact.

## 4. M22 no-repair leg

```
resolved 1/15 = 6.7%
wrote=9 validToolCallTasks=9 toolExecuted=9 timeouts=4 syntaxErrors=4 proseOnly=6
```

The first verified pass in the sequence is `HumanEval/7`. Delivery improved on
every axis: written files 4 → 9, valid tool calls 5 → 9, prose-only 10 → 6.
Timeouts rose 3 → 4, which is expected: a task that now writes a file spends its
budget iterating instead of giving up early.

## 5. Failure attribution (the core M22 finding)

The M22 change that made this possible is `emitFullToolArgs` (see §7). Before
it, every recorded `tool/call` truncated its `arguments` to 500 chars, so the
transcript cut the generated code off mid-line and no failure could be
attributed from the committed artefact. With full bytes captured, the nine
written files classify as:

| class | count | tasks |
|---|---|---|
| unterminated string literal | 4 | /0, /2, /3, /8 |
| missing function body | 1 | /12 |
| parses but no entry point (tiny body) | 3 | /1, /10, /11 |
| correct and passing | 1 | /7 |

The dominant defect is **not** M21's literal-`\n` double-escape. M21's RC#2
normalizer (`repairCorruptEscapes`) targets JSON-escaped bodies; in this draw
**zero** files carried a lone backslash or a literal `\n`. The model emitted
real newlines and then simply stopped inside a `"""` docstring, leaving an
unterminated string. The normalizer correctly did not fire. This is a
*generation* failure — the model ran out of intent mid-body — not a
*transport* failure. No decoder can invert it, which is the same boundary M21
hit and called "the boundary between a repair and a rewrite".

A second, distinct defect appears in three tasks: the model writes a
few-dozen-byte file that parses but does not define the task's function at all.
That is a *scope* failure — the model answered a different question than the one
asked — and it is invisible to a syntax check.

## 6. What M22 actually changed

Two code changes and one measurement tool. No change touches the model or the
prompt; all three are JEXI-side.

### 6.1 `emitFullToolArgs` — record the code the model wrote

`server/src/services/AgentLoop.js` emitted `tool/call` with
`arguments: JSON.stringify(...).slice(0, 500)`. The 500-char cap is a UI
courtesy (the TUI renders 120 chars anyway), but it also truncated the generated
code out of every recorded transcript, so a benchmark could not inspect what the
model wrote. The write itself was never truncated — only the recording — which
is exactly the kind of defect that makes a pipeline look like a model
limitation.

The fix is opt-in: when `opts.emitFullToolArgs` is set (benchmarks set it), the
whole payload is kept; the default stays capped for the UI. Guarded by two
tests (`M22/D7`): the opt-in path is byte-identical to what was written, and the
default path stays capped.

### 6.2 `measure.mjs` — an AST-based, honest classifier

A new script that derives `syntax-valid`, the syntax-error buckets,
`duplicate-def`, `placeholder-stub`, and `truncated` from the real bytes via
CPython, computes AST metrics over written files only, prints per-metric
denominators, and reports repair-recovery for the bounded-repair leg.

It also corrects two counting defects in the probe's own summary line. The
probe reports `syntaxErrors=4` by regexing the grader tail for the literal
`SyntaxError`; task `/12` fails with an `IndentationError`, which the regex
misses, so the true count is 5. And the probe's `syntaxErrors` is a *grader*
signal — it only fires when the grader got far enough to compile — whereas
`measure.mjs` classifies the bytes directly. The two are reported side by side
rather than reconciled silently.

### 6.3 Python syntax verification (committed earlier as `4ac7cba`)

A `SyntaxVerifier` that compiles the changed `.py` files and layers a structural
reader on top for the shapes the compiler accepts but the task rejects
(unterminated triple-quote, a `"""`-wrapped body, a duplicate top-level `def`,
a placeholder body, a missing entry point). In a Python sandbox the lint layer
was `inapplicable` (ESLint is a JS linter) and the unit layer was
`unverifiable`, so nothing ever told the model its file did not parse.

## 7. Paired comparison

See the table in §1. Reading the two draws together:

- **Delivery is fixed.** Prose-only halved (10 → 6); written files more than
  doubled (4 → 9). M21's recovery work holds up on a second draw.
- **Code quality is not fixed.** Syntax-valid stayed near half of written files
  (2/4 baseline vs 4/9 M22 — too few written files in the baseline to call this
  a regression, but no improvement).
- **The first pass appeared** (`HumanEval/7`), which is the first verified pass
  in the M18–M22 sequence.

The comparison is a single paired draw. A 0-vs-1 difference is within the noise
M21 measured, so the resolved-rate change is *suggestive, not significant*. The
delivery change is large enough to be read as real.

## 8. Bounded test-driven repair (Condition B)

Condition B is M20's bounded-repair driver: run the task, grade it, feed the
**real failing output** plus the current file back, and retry — at most 2
repairs. `benchmarks/humaneval-live/m20-repair.mjs`, run on the same 15 tasks
with the same `fs-names` first-attempt prompt (so Condition A is the same draw's
first attempt, not a different prompt). Artifact:
`results/m20-repair-2026-11-05T15-09-33-439Z.json`.

```
A 0/15 = 0.0%   (first attempt)
B 3/15 = 20.0%  (after bounded repair)
delta = +20.0 pp · recovered-by-repair=3 · repairsAttempted=28
```

The three recoveries are real, and the failing output that drove them is
informative:

| task | first-attempt failure | repairs | final |
|---|---|---|---|
| /3 | `SyntaxError: unterminated triple-quoted string literal (detected at line 20)` | 1 | PASS |
| /5 | `AssertionError` | 2 | PASS |
| /7 | `AssertionError` | 1 | PASS |

Two things stand out.

**Repair fixes both failure classes.** One recovery was a syntax failure (/3)
and two were logic failures (/5, /7). Feeding the real error back is enough to
turn all three around within two attempts.

**Repair eliminates the unterminated-string defect.** Across the final written
files, `syntax:unterminated` falls from 4/9 (no-repair) to **0/11** (repair), and
syntax-valid rises from 4/9 to 8/11. The mechanism is visible in the first
attempt's error: an unterminated string is exactly the failure the model can fix
when it is *told*, because the fix is mechanical once the error names the line.
This is the strongest evidence in M22 that the unterminated-string defect is a
*stopping* failure, not a *capability* failure: the same model writes a valid
file the moment the failure is surfaced to it.

**Cost.** 28 repairs across 15 tasks — every task spent its full budget, and the
run took ~2 h 15 m wall clock versus ~55 m for a no-repair leg. Repair is
expensive in wall clock but cheap in passes gained (3).

The repaired legs also show `file-write 11/15` and `tool-call 15/15`: every task
produced at least one tool call and eleven produced a real file. The remaining
failures are logic (3 tasks whose body parses but does not solve the task) and
two placeholder stubs, not syntax.

## 9. What is left

1. **Unterminated strings are a *stopping* defect, and bounded repair is the
   demonstrated fix.** §8 shows the same model writing a valid file the moment
   the `SyntaxError` is fed back: the defect drops to 0/11 written files under
   repair. The cheapest correct response is therefore to make repair the default
   path in the coding loop, not to build a smarter decoder. A decoder cannot
   recover intent the model never emitted; a retry can.
2. **Scope failures are invisible to syntax checks.** Three files parsed and
   simply did not define the entry point. A verifier should check that the
   *entry point exists* in the written file, not only that the file compiles.
   The structural reader (`python-structure.js`) already detects this shape; the
   gap is that nothing feeds it back as a repair signal yet.
3. **`pytest` still cannot check an exec-style test file.** M21 made this layer
   `unverifiable` rather than falsely failing; the exec-style runner (M22/D5)
   gives it a real verdict, but the end-to-end effect on the pass rate is not
   yet measured.
4. **Git reconciliation.** `origin/main` is at `cfc9581` (M17); local `main` is
   several commits ahead with M18–M22 never pushed. The M22 artefacts and this
   document are part of what is unpushed.
