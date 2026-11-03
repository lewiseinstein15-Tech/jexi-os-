# M19 — Deterministic Tool-Calling Reliability

Mission: raise JEXI's ability to **reliably execute coding tasks** by fixing
confirmed tool-payload defects and reducing failures from missing or malformed
tool calls. The objective is reliable execution, NOT a better benchmark score.
Repo `lewiseinstein15-Tech/jexi-os-`, branch `main`, start commit `4e6d0e5`
(M18). Model `llama3.2:3b`, provider `ollama`, locked (`JEXI_PROVIDER_LOCK=ollama`,
`ladderSlid=0`).

The M17 floor (209/209 suites, 7/7 completion-integrity scenarios) is the bar
this mission must not break. The M19 tree runs **210/210 suites** — the M17
count plus the new M19 suite; 0 failures.

## Verdict

Two confirmed JEXI-side defects were found and fixed. Both are deterministic,
both are bounded, and neither fabricates a tool call or bypasses a gate.

1. **Write-payload double-escaping (M18/R2, extended).** A write-tool `content`
   that carries literal `\n`/`\t` two-character sequences instead of real
   newlines is written to disk verbatim and the file does not parse. M18 saw the
   pure form (every newline escaped). M19 measured a second form live: a
   **mixed** payload where the literal escapes OUTNUMBER real newlines but at
   least one real newline is present. The original guard ("no real newline at
   all") refused the mixed form, so it still failed. Fixed with a
   string-aware decoder plus a dominance guard.

2. **Tool-name alias gap (M18/R1, the dominant failure).** The model writes a
   well-formed call under a name JEXI itself advertises — `code_write` /
   `code-write` — while the offered menu contains the domain implementation
   `fs_write`. `recoverToolCallsFromText` correctly refused an unoffered name,
   so the turn died with zero tool calls. The benchmark prompt *itself* says
   "use the code-write tool", so this was a real interface mismatch, not model
   noise. Fixed with a bounded, menu-gated alias table plus a path-key bridge.

3. **Bounded malformed-call retry.** A call the model clearly intended but whose
   arguments do not parse (usually a truncated `content`) now gets ONE re-ask for
   a valid native call, instead of ending the turn with zero calls.

**Headline measurement** — a controlled before/after on the SAME 5-task slice,
locked to ollama with no ladder slide, source fixes stashed for the "before"
leg and restored for the "after" leg:

| leg | resolved | timeouts | SyntaxErrors | note |
|-----|----------|----------|--------------|------|
| before (`4e6d0e5`) | **0/5** | 2 | — | HumanEval/3 written `litN=8 realNL=0` → loops → TIMEOUT |
| after (M19) | **1/5** | **0** | **0** | HumanEval/3 repaired to `realNL=11` → **PASS** |

Every `fs_write` the model attempted in the after run now executes successfully
(`toolResults.ok=true`), and every written file parses. The remaining failures
are algorithmic (`AssertionError`) — the model wrote parseable, executable,
wrong code. That is the honest boundary: the plumbing defects are gone; the
residual is a model-capability ceiling, exactly as M18 predicted.

The measurement is directional (n=5). It is reported as raw and unadjusted. No
task was hand-tuned, no answer was injected, and the graded artifact remains the
file the model left on disk.

## Phase 1 — Root cause, from the live wire

The M18 conclusion was "the model writes the call as prose with a name
(`code_write`) not in the offered menu, so recovery correctly refuses it". M19
confirmed this on the real request and found it is the **dominant** failure.

Reproduced verbatim from a live `ollama` round (the round that would have died
with zero calls):

```
{"name":"code_write","parameters":{"path":"/tmp/.../solution.py",
 "content":"from typing import List\\n\\ndef has_close_elements(...)..."}}
```

Offered menu on that request: `fs_read, fs_write, fs_edit, term_execute,
pytest_run, capability_check, ask_user_question, request_tools`.

JEXI advertises `code-write` in `services/ToolRegistry.js` and implements
`fs_write` in `tools/domains/filesystem/index.js`. There was no bridge, and the
benchmark query instructs the model to use `code-write` by name. The alias gap
is therefore a JEXI interface defect, not a model defect.

### Controlled experiment (Phase 3 harness)

`benchmarks/humaneval-live/toolcall-reliability.mjs` captures the REAL assembled
prompt and the REAL tool menu by intercepting a live `AgentLoop` run (only the
endpoint is stubbed, and only for the capture). It then issues real rounds to
the local model and classifies each outcome: `native`, `recovered`, `invalid`,
`no-call`, `error`. Four conditions, 3 reps each, on `HumanEval/0`:

| condition | menu | usable | note |
|-----------|------|--------|------|
| A full-prompt | 8 tools | 1/3 → **2/3** after alias fix | the shipped shape |
| B reduced-prompt | 8 tools | 0/3 | prompt trimming alone does not help |
| C reduced-catalogue | 5 tools | 2/3 | a smaller menu helps the native rate |
| D concise-desc | 8 tools | 0/3 | shorter descriptions alone do not help |

After the alias fix, the rounds that still fail no longer try the wrong name —
they try `fs_write` correctly and fail on unparseable (truncated) arguments.
That is what motivated the bounded retry.

## Phase 2 — Write-payload normalizer

`server/src/services/agent/WritePayloadNormalizer.js` (new) exports
`normalizeWriteArgs(slug, args)`, `isDoubleEscapedPayload(content)`,
`decodeEscapedControls(content)`, `WRITE_CONTENT_TOOLS`.

Rules that keep it honest:

1. Applies ONLY to whole-file bodies (`fs_write`, `fs_append` `content`) — never
   a search needle or an arbitrary argument.
2. `isDoubleEscapedPayload` fires when the payload has literal `\n`/`\t` and
   either no real newline, or literal escapes that OUTNUMBER real newlines
   (the mixed form).
3. `decodeEscapedControls` is a hand-written string-aware scanner: `"…"`,
   `'…'`, `"""…"""`, `'''…'''` regions are preserved, so `x = "a\nb"`, a regex,
   or a Windows path inside a string is never corrupted.
4. If the decode is a no-op the ORIGINAL object reference is returned, so
   callers can compare cheaply.

Wired into `server/src/services/ToolRuntime.js` inside `executeToolInner`, so
every write call — native or recovered — passes through it. A change emits a
`tool.payload_normalized` event; nothing is silent.

## Phase 3 — Alias resolution + bounded retry

`server/src/services/agent/ToolCallRecovery.js` (extended):

- `TOOL_ALIASES` — a small, explicit table mapping plausible names to canonical
  DOMAIN tool slugs (`code-write`→`fs_write`, `code-run`→`term_execute`,
  `run-tests`→`pytest_run`, `list-files`→`fs_ls`, …).
- `resolveToolName(rawName, offeredNames)` — resolves case-insensitively after
  hyphen/underscore/dot folding, and accepts an alias ONLY when its TARGET is in
  the offered menu. An alias to a tool this session did not offer resolves to
  `null`: recovery can never expand the menu.
- `filename`→`path` remap for the write/read tools, applied only when `path` is
  absent, so a call that already carries `path` is never disturbed.

`server/src/providers/runtime/LLMClient.js` (extended): after native-call
recovery, if the round still produced no calls but clearly attempted one
(`looksLikeToolAttempt`), the loop re-asks ONCE for a valid native call. The
retry is bounded to one per turn (`malformedRetryUsed`), is opt-out
(`opts.__noMalformedRetry`), and its output goes through the same
native/recovery parse — nothing is fabricated. `AgentLoop` surfaces it as an
`agent.log` line so the retry is visible rather than silent.

## Evidence

| fact | value |
|------|-------|
| start commit | `4e6d0e5` (M18) |
| suite count | **210/210 pass, 0 fail** (was 209; +1 M19 suite) |
| M19 suite | `server/tests/agi/test-m19-write-payload-normalization.js`, 28 tests |
| M15 suite | 28 tests, 27 pass / 1 skipped (unchanged invariant; one example name updated because M19 now bridges it) |
| baseline slice (pre-fix, locked) | `results/humaneval-jexi-as-shipped-2026-11-03T00-09-03-026Z.json` (sha256 `e1d0c40a35214cab…`) — 0/5, `timeouts=2`, HumanEval/3 `litN=8 realNL=0` |
| after slice (post-fix, locked) | `results/humaneval-jexi-as-shipped-2026-11-02T23-51-13-681Z.json` (sha256 `3408c0d790593efd…`) — **1/5**, `gradedGreen=1`, `timeouts=0`, `graderErrors=0`, `ladderSlid=0` |
| phase-3 experiment | `results/m19-toolcall-reliability-*.json` (4 conditions × 3 reps) |

In the after run every written file parses: HumanEval/1 moved from
`literal \n = 7` (broken) to `real newline = 7, literal \n = 0` (repaired), and
the run contains **no `SyntaxError` and no timeout**.

## Limitations

- The headline is n=5 on one slice with one small model. It is directional, not
  a population estimate. The mechanism (alias gap + mixed escaping) is
  deterministic and covered by unit tests; the pass-rate delta is not.
- The residual failures are algorithmic. No JEXI change fixes a wrong algorithm;
  a larger model is the lever there, which is out of scope for this mission.
- The local `ollama` `/v1` lane still evaluates a bounded prompt (M18/R3); the
  alias fix does not depend on the full prompt being seen, because the model
  consistently emits the write call regardless.
- The benchmark query text asks for `code-write`/`code-run` by name. That is
  now bridged, but the cleaner long-term fix is to align the query text and the
  registry with the offered domain names; the bridge is the safe, minimal change
  that does not alter the public tool surface.

## Reproduce

```bash
# unit + integration
cd server && node --test tests/agi/test-m19-write-payload-normalization.js
node tests/setup/run-suites.mjs            # 210 suites

# controlled experiment
DOTENV_CONFIG_QUIET=true MODEL_PROVIDER=ollama OLLAMA_HOST=http://127.0.0.1:11434 \
  BENCH_MODEL=llama3.2:3b node benchmarks/humaneval-live/toolcall-reliability.mjs --reps 3 --task 0

# end-to-end slice (locked, deterministic)
DOTENV_CONFIG_QUIET=true MODEL_PROVIDER=ollama JEXI_PROVIDER_LOCK=ollama \
  OLLAMA_HOST=http://127.0.0.1:11434 BENCH_MODEL=llama3.2:3b \
  MODEL_NAME=llama3.2:3b OLLAMA_MODEL=llama3.2:3b \
  node benchmarks/humaneval-live/run.mjs --leg jexi --tasks 5 --timeout 300 --profile full --schema as-shipped
```
