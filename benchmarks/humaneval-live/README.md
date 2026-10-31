# HumanEval live benchmark — JEXI's first externally grounded coding measurement

This harness measures JEXI's real agent loop against **HumanEval**
(`openai/openai_humaneval`, split `test`), a public coding benchmark with
164 tasks, each with a canonical solution and a unit test.

It is a **measurement**, not a feature. It changes no JEXI source. It drives
the shipped `runAgentLoop`, executes whatever tools the model actually calls
through the real gated `ToolRuntime`, and grades the file left on disk with
the **official HumanEval grading logic** inside a throwaway Docker container
(`--network none`).

## Why HumanEval, and not SWE-bench

SWE-bench Verified is the stronger signal for agentic coding, and JEXI ships a
real, gated loader for it (`benchmarks/swebench-pro/dataset.js` →
`loadHf`, `allowNetwork: true`). It is not the pilot here for two environmental
reasons, both recorded rather than worked around:

- **Image cost.** One SWE-bench Verified eval image is ~1.13 GB compressed
  (measured: `swebench/sweb.eval.x86_64.astropy_1776_astropy-12907`). A
  meaningful slice is tens of images against 24 GB of free disk.
- **Repo-level tasks.** SWE-bench needs a real checkout at a base commit plus
  the repo's own test runner, per instance.

HumanEval gives a *real, graded, comparable* number at a cost this environment
can pay, and it exercises the same loop (read → write → run → observe). The
SWE-bench leg is the documented next step, not a claim made here.

## The result

The measured result, its root cause, and the evidence are in
[`RESULTS.md`](./RESULTS.md). Short version: gold 10/10, JEXI as-shipped 0/15.
The zero is a **tool-adoption** failure — the model answers in prose instead of
calling a tool — reproduced by `probe-toolmenu.mjs`, which replays the exact
request JEXI sends while varying the size of the offered tool menu.

## Reproduce

```bash
# 1. Prove the harness itself (canonical solutions must score 100%)
node benchmarks/humaneval-live/run.mjs --leg gold --tasks 20

# 2. Measure JEXI as shipped
node benchmarks/humaneval-live/run.mjs --leg jexi --tasks 20 --schema as-shipped

# 3. Ablation: same loop, but the tool schemas JEXI forgot to send are repaired
node benchmarks/humaneval-live/run.mjs --leg jexi --tasks 20 --schema repaired
```

Every run writes `results/<runId>.json` containing a manifest (dataset sha256,
git commit, dirty flag, model, docker image, node version) and one row per task
with the tool calls, tool results, grader output and verdict.

## The legs

| leg | what it is | what a score means |
|---|---|---|
| `gold` | canonical solutions, graded by the same grader | harness validity — must be 100% |
| `jexi --schema as-shipped` | the real loop, exactly what JEXI builds today | **the headline number** |
| `jexi --schema repaired` | the real loop, plus `lib/schema-patch.mjs` | ablation: isolates a wiring bug from model capability |
| `jexi --schema documented` | the real loop, tool args spelled out in the system prompt | ablation: does prose help when the schema is empty? |

## Known finding: domain tools are advertised with empty parameter schemas

Measured, not inferred:

```
buildOfferedTools({plan, query}) →
  fs_write schema = { "parameters": { "type": "object", "properties": {}, "required": [] } }
  term_execute schema = { "parameters": { "type": "object", "properties": {}, "required": [] } }
```

The chain:

1. `resolveToolDef('fs_write')` (in `services/ToolRuntime.js`) returns a probe
   stub `{slug, name, desc, permission}` for anything that lives in the **domain**
   registry — the real `parameters` are dropped.
2. `buildNativeSchemas` then falls back to `TOOL_SCHEMAS[slug]`, which has **no**
   entry for domain tools.
3. The model is therefore told `fs_write` takes no arguments.
4. The model calls `fs_write {}`; the execute gate validates against the **real**
   schema from the domain registry and rejects it:
   `schema: $: missing required property "path"`.

The tool itself is fine: `domainDispatch('fs_write', {path, content})` writes the
file correctly (verified). Only the *advertisement* is wrong.

`lib/schema-patch.mjs` repairs the advertisement in-memory for the ablation leg.
It never touches JEXI source.

## Honesty notes

- The keyless provider floor (kilo → pollinations) is used when no API key is
  configured. The model identity is recorded in the manifest. A result from a
  small free model is a real result for *that* model, and is labelled as such —
  it is not a claim about JEXI with a frontier model.
- Grading runs with the network disabled, so a solution cannot fetch its answer.
- No task's expected output is ever injected into the agent's context.
