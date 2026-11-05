# M21 — Agent Intelligence & Execution Strategy

Mission: find out WHY JEXI's coding performance stays poor when the tool
infrastructure — sandbox, payload normalization, bounded retries, the
verification gate — is all working, and fix the defects that are actually on
the path. Repo `lewiseinstein15-Tech/jexi-os-`, branch `main`. Model
`llama3.2:3b` via `ollama`, locked (`JEXI_PROVIDER_LOCK=ollama`, `ladderSlid=0`).
Harness `benchmarks/humaneval-live/m21-probe.mjs`, dataset HumanEval, sha256
`094a17ac…`, 15-task slice, `profile full`, `schema as-shipped`,
`query fs-names`. Grader: the official HumanEval `GRADE_PY`, run locally.

## Verdict

- **The binding constraint is not the model's coding ability. It is that the
  bytes the model already wrote never reach the file.** On the final pre-fix A
  run, 6 of the 15 tasks ended with ZERO tool calls — and every one of those 6
  answers contained a complete, plausible implementation, in a fenced
  ` ```python ` block, in the model's own reply. The model solved the task and
  then declined to call the tool. That is a delivery defect, not a capability
  ceiling. The defect is now closed: the final post-fix A run wrote 9 files,
  up from 5, and left only 3 tasks prose-only, down from 9.
- **Three root causes were found and fixed on the path.**
  - **RC#1 — prose pseudo-commands.** The model emits tool calls as text, in a
    bash/heredoc shape (`fs_write <path> <<EOF … EOF`) or a bracketed shape
    (`[fs_write]…[/fs_write]`). The JSON-only recovery found nothing, the round
    ended with zero calls, and the task died unwritten. Fixed in
    `ToolCallRecovery.js` (`recoverBashPseudoCommands`).
  - **RC#2 — corrupted write payloads.** The model JSON-escapes a Python body
    and writes the escapes to disk verbatim (`\n`, `\"`, and — the shape that
    dominated the final runs — a **lone backslash where a line break belongs**,
    which glues docstring lines together and raises "unterminated triple-quoted
    string literal"). Fixed in `WritePayloadNormalizer.js` (whole-body JSON
    decode, mixed-shape repair, stray-backslash-before-indent repair).
  - **RC#3 (M21/D10) — a fenced block with no call.** The recovery gate
    (`looksLikeToolAttempt`) only recognised a JSON shape, so an answer that
    carried the whole file in a fenced block plus a bare `fs_write <path>` was
    never turned into a call. Fixed in `ToolCallRecovery.js`
    (`recoverFencedCodeWrite`), including truncated (unclosed) fences, the
    instruction-derived path hint, and duplicate-write collapse. This is the fix
    that moved the delivery numbers.
- **A third defect was a FALSE FAILURE, not a model failure.**
  The HumanEval sandbox ships `test_<entry>.py` as a bare script that calls
  `check(<entry>)` with no import. `pytest -q` therefore raises
  `NameError: name '<entry>' is not defined` on **every** task — including
  correct ones — while the official grader (which `exec`s the solution into the
  test namespace) passes the same bytes. That NameError was injected into the
  model as a failure to fix, and drove it into a rewrite loop (measured:
  HumanEval/13 wrote a correct gcd and thrashed to the 300 s cap). Fixed in
  `TestVerifier.js` (`looksLikeExecStylePytest` → honest `unverifiable`).
- **Verified resolved rate is unchanged at 1/15 (6.7%).** No false successes, no
  regressions (212/212 suites green). The write rate and the syntax-error rate
  moved, but at n=15 the resolved rate is inside run-to-run noise. The honest
  read is: the fixes removed real defects from the path and did not inflate the
  score.

## The measurement is stochastic — read every number with its band

The same commit, same locked config, same slice produced 0/15 and 1/15 across
preserved runs. Temperature 0.3 with no seed, so each run is a fresh sample.
All M21 numbers below are reported as a draw from that distribution.

| artifact (UTC) | prompt | resolved | wrote | valid call | executed | syntax | prose-only | timeouts |
|---|---|---|---|---|---|---|---|---|
| 2026-11-03T15-30-09 | A | 0/15 | 8 | 8 | 8 | 5 | 7 | 2 |
| 2026-11-03T19-06-13 | A | 1/15 | 6 | 8 | 6 | 4 | 7 | 1 |
| 2026-11-03T20-40-36 | A | 1/15 | 7 | 10 | 7 | 4 | 5 | 0 |
| 2026-11-03T21-41-22 | A | 0/15 | 9 | 10 | 9 | 5 | 5 | 0 |
| 2026-11-03T22-46-35 | A | 1/15 | 9 | 9 | 9 | 6 | 6 | 0 |
| 2026-11-03T23-37-56 | A | 1/15 | 8 | 9 | 8 | **3** | 6 | 2 |
| 2026-11-04T01-16-58 | A | 1/15 | 9 | 9 | 9 | 5 | 6 | 0 |
| 2026-11-05T01-45-03 | A | 0/15 | 7 | 7 | 7 | 4 | 8 | 0 |
| 2026-11-05T02-40-21 | A | 0/15 | 5 | 6 | 6 | 5 | 9 | 0 |
| **2026-11-05T03-58-03** | **A** | **0/15** | **9** | **12** | **9** | **3** | **3** | **0** |
| 2026-11-03T17-52-20 | B | 0/15 | 8 | 11 | 9 | 6 | 4 | 0 |
| 2026-11-03T19-48-07 | B | 0/15 | 6 | 10 | 8 | 5 | 5 | 0 |
| 2026-11-04T00-22-18 | B | 1/15 | 4 | 6 | 4 | 2 | 9 | 0 |

Prompt B (the compact prompt) is measurably *worse* at delivery than prompt A:
its final run wrote only 4 files and left 9 tasks prose-only. The verbose
shipped prompt is the better of the two, so prompt A is the reference.

## RC#1 — the call is written as text, not emitted as a call

Measured on the final A run, 6 of 15 tasks produced zero tool calls. The
answers are not refusals and not empty — they are complete implementations in
fenced code blocks:

```
Here is the complete implementation of the Python function:
```python
from typing import List
import re

def separate_paren_groups(paren_string: str) -> List[str]:
    """ Input to this function is a string containing m…
```

Two shapes appear:

1. **Fenced code block** — `Here is the complete implementation … ```python …```.
   The dominant shape (tasks /1, /3, /4, /6, /10).
2. **Bracketed pseudo-call** — `[term_execute]python <path>/test_x.py[/term_execute]`
   and `[fs_write]python <path>/solution.py[/fs_write]`, followed by the body.
   The model is addressing the tool by name in a bracketed tag (task /8).

The bash/heredoc shape (`fs_write <path> <<EOF … EOF`) that was the original
RC#1 signature is recovered by `recoverBashPseudoCommands`, wired as a fallback
inside `recoverToolCallsFromText()`. Recovery is narrow by construction: the
tool name must resolve into the OFFERED menu, the heredoc must be CLOSED, and
the recovered call still runs through the same gated `executeToolCalls` path.
Recovery changes which calls are seen, never what they are allowed to do.

**The remaining gap — CLOSED (M21/D10).** `looksLikeToolAttempt()` — the gate
that decides whether the bounded malformed-call retry fires — tests only for a
JSON shape (`{"name": …}`). A fenced code block is not a JSON shape, so the
retry never fired on the single most common delivery failure. The fix is
`recoverFencedCodeWrite()` in `ToolCallRecovery.js`, wired as a third pass
inside `recoverToolCallsFromText()`:

- the round must have produced **zero** calls, so a native call is never
  overridden;
- a write tool must be in the **offered** menu;
- the fenced block must contain a real `def`/`class` (a fenced shell transcript
  or a bare statement is not a file body);
- the target path comes from a bare `fs_write <path>` reference in the answer,
  or — only when the **instruction itself** asks for a write — from the path the
  instruction names (`extractTargetPath` + `isWriteInstruction`);
- the recovered call runs through the **same gated** `executeToolCalls` path.

Measured live on the post-fix A run (2026-11-05T03-58-03): the delivery class
collapsed. Prose-only tasks fell from **9 to 3**, wrote rose from **5 to 9**,
and valid tool-call tasks rose from **6 to 12** — the recovery fired on the
tasks the pre-fix run had left as prose, converting a fenced answer into a real
`fs_write` with a real body (`recovered=1 wrote=true`). Two refinements were
needed to get there, both found by dumping the raw rounds:

- a fence the model never CLOSED (it hit the token cap mid-body) was being
  dropped; a truncated fence still carries a complete body, so the extractor
  now accepts an unclosed fence, capturing only up to the next opener or EOF;
- the bounded malformed-call retry recovered WITHOUT the instruction hint, so a
  retry answer with no bare `fs_write <path>` recovered nothing; the hint is now
  threaded into that path too.

When several recovered calls write the same file (a fenced block plus a heredoc)
the loop would otherwise write both and last-writer-wins picks the shorter body;
recovered duplicate writes of the same tool to the same path now collapse to the
most complete one. The gate stays conservative: an "explain /app/foo.py" turn
names a path but is not a write instruction, so the model's quoted snippet is
never written back over the user's file. All four cases are covered by tests.

The residual failures are no longer delivery. Of the 9 files written, the
failures are model code quality: unterminated docstrings, a `"""`-wrapped body,
a duplicate `def`, and one wrong algorithm. That is RC#2's territory, not
recovery's — see "What is left".

## RC#2 — the write payload is corrupted, so the file never parses

The model JSON-escapes a Python body and writes the escapes to disk verbatim.
Three shapes were found, in order of how much they cost:

| shape | what the model wrote | what Python saw | count (final A) |
|---|---|---|---|
| fully JSON-escaped | `"from typing import List\n\ndef f():…"` | literal `\n` in the source | 4 writes |
| stray backslash line | `    \` on its own line before `"""` | `unexpected character after line continuation` | — |
| **lone backslash for a line break** | `decomposed into\    and integer part` | docstring never closes → `unterminated triple-quoted string literal` | 4 writes |

The third shape is the one that dominated the final runs, and it is subtle: the
model types a backslash where each docstring newline should be, gluing lines
together, and then switches to literal `\n` for the rest of the body. The
result is an even number of `"""` (so a naive odd-count check misses it) and a
backslash that is not on its own line. `hasBackslashBeforeIndent()` is the
signal that catches it: a lone backslash followed by indentation and more code
on the same line is never valid Python outside a string, and a string would need
an escaped space the model did not write.

`repairCorruptEscapes()` decodes the JSON escape set everywhere and restores a
real newline for that shape. The repair is gated on evidence of corruption
(a stray-backslash line, an open triple quote, or a backslash-before-indent) so
an ordinary file is never rewritten. `decoded-literal-newlines` (the M19 path)
and `repaired-corrupt-escapes` (the new path) fired 4 times each on the final A
run — the normalizer is doing real work on the majority of written files.

**What the normalizer cannot do.** On tasks /0, /2 and /12 the file was repaired
and still did not parse, because the model's own emission was internally
inconsistent — it wrote `"""` for a docstring and then a duplicate function
definition, or a `def` whose body was indented four extra spaces. The bytes
were corrupt at the source in a way no decoder can invert. This is the boundary
between a repair and a rewrite.

## The false failure — pytest cannot check an exec-style test file

This one was a JEXI-side defect masquerading as a model failure.

The HumanEval sandbox materialises `test_<entry>.py` as a bare script:

```python
def check(candidate):
    assert candidate(3, 7) == 1

def test_check():
    check(greatest_common_divisor)
```

There is **no import of `solution.py`**. `pytest -q` imports the test file,
`check` runs, and `greatest_common_divisor` is not defined:

```
NameError: name 'greatest_common_divisor' is not defined
```

The official grader does not do this — it `exec`s the solution into the test
namespace first, which is why it PASSES the same bytes. So the auto-detected
`pytest` runner reported a failure on a correct solution, and the coding loop
injected that NameError into the model as something to fix. On HumanEval/13 the
model had written a correct gcd; told to fix a NameError it did not cause, it
rewrote the file until the 300 s cap. The benchmark scored it a timeout.

`looksLikeExecStylePytest()` recognises the shape — every failure is a bare
`NameError: name '…'`, and the test file imports nothing — and the layer
returns `unverifiable` instead of `fail`. `autoVerify` skips `unverifiable`
layers exactly as it skips `inapplicable` ones, so the loop neither ticks green
nor injects a bogus fix. The check is deliberately narrow: a real test file
imports its module, so a genuine NameError inside it still fails, and a genuine
`assert 1 == 2` in an exec-style file still fails. Both negative cases are
covered by tests.

## Phase — failure taxonomy (final A run)

| class | count | tasks | what actually happened |
|---|---|---|---|
| **no usable call — complete code in a fenced block** | **6** | /1 /3 /4 /6 /8 /10 | model solved it in prose, never called the tool |
| **syntax in the written file** | **5** | /0 /2 /9 /12 /13 | repaired payload still internally inconsistent |
| **written, parsed, wrong answer** | **3** | /5 /11 /14 | genuine model error |
| **PASS** | **1** | /7 | correct implementation, graded green |

The taxonomy puts the largest single class at the top: **6/15 tasks where the
model had the right answer and the loop did not deliver it.** That is the
headline finding of M21. The model-ceiling class (written, parsed, wrong) is
only 3/15.

## What was verified

- **M19 normalizer suite:** 28/28.
- **M21 execution-strategy suite:** 24/24 (D4–D8, including the new
  triple-quote, exec-style, and heredoc cases).
- **Verification suites:** `test-verification-independence.js`,
  `test-verification-spawn.js` — green.
- **Full regression:** 212 suites, 212 passed, 0 failed, exit 0. M21/D10 unit
  suite: 35 tests, 35 passed.
- **JSON round-trip:** prompts 93/100, canonical 12/100 — byte-exact.

## What is left

1. **Internal-inconsistency repair.** The residual syntax failures are now
   corruptions a decoder cannot invert (an unterminated docstring, a
   `"""`-wrapped body, a duplicate `def`). This is where a repair loop that
   re-reads its own output would help.
2. **The resolved-rate ceiling.** 0–1/15 is stable across prompt variants and
   fixes; the delivery class is now largely closed (prose-only 3/15), so the
   remaining ceiling is code quality on a 3B model. Delivery is no longer the
   binding constraint — the next lever is verification-driven repair, not
   recovery.

No false success was recorded in any run. Every PASS came from the official
grader, and the verification gate never reported `verified` on a red suite.
