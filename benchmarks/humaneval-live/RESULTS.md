# M11 — JEXI's first reproducible, externally grounded coding benchmark result

**HumanEval (openai/openai_humaneval, split `test`), graded by the official
HumanEval `check()` inside a network-isolated `python:3.11-slim` container.**

This is a measurement mission. No JEXI source was modified to improve a score.
The only files added are the harness itself (`benchmarks/humaneval-live/`).

## Headline

| leg | what it measures | result |
|---|---|---|
| **gold** | canonical solutions through the same grader | **10/10 = 100.0%** |
| **jexi, as shipped** | JEXI's real agent loop, real tool runtime | **0/15 = 0.0%** |
| **jexi, schema-repaired** | same loop, tool schemas repaired in-memory | **0/15 = 0.0%** |

The gold leg at 100% proves the harness is valid: the grader accepts correct
solutions and the isolation does not break them. The JEXI legs are therefore a
real measurement of the loop, not a broken grader.

- dataset sha256 `094a17ace7a536483e83cd6bb0348c9df1e2bb532ff4e09961665a8b9414c157`, 164 tasks total
- model `llama3.2:3b` via a local keyless Ollama (`MODEL_PROVIDER=ollama`, `OLLAMA_HOST=http://127.0.0.1:11434`)
- tool profile `full` (the only profile that permits the risky `code-write`/`code-run` tools)
- git commit `d10d72cf` (working tree dirty: the harness is uncommitted), Node v24.21.0
- raw evidence: `results/humaneval-gold-documented-2026-10-30T23-44-03-356Z.json`,
  `results/humaneval-jexi-as-shipped-2026-10-30T23-07-58-344Z.json`,
  `results/humaneval-jexi-repaired-2026-10-30T23-35-41-644Z.json`

## Why the score is zero — root cause, measured

The failure is **not** that the model writes bad Python. It is that **the model
almost never calls a tool at all** (14 of 15 tasks: `tools=0`). With no file
written, the graded artifact is empty and every task fails identically.

The reason is a property of the small local model, confirmed by replaying the
exact request JEXI sends directly against Ollama and varying one input at a time:

| condition | tool-call rate |
|---|---|
| JEXI system prompt + 41 tools, temp 0.3 | 0/4 |
| **short** system prompt + 41 tools, temp 0.3 | 0/4 |
| JEXI system prompt + 41 tools, temp 0.0 | 0/4 |
| JEXI system prompt + **3** tools, temp 0.0 | 0/4 |
| **short** system prompt + **3** tools, temp 0.3 | **3/4** |

- **Tool-menu size is the dominant factor.** With all 41 offered tools the model
  ignores the tools and writes a prose answer (a code block in the reply text).
  With a 3-tool menu and a short prompt it calls `code-write`.
- **The JEXI system prompt also suppresses tool use.** At the same 3-tool menu,
  the short prompt calls a tool 3/4 times and the JEXI prompt 1/4 — the ~25 KB
  JEXI identity/agent prompt biases a 3B model toward prose.
- **Streaming is not the cause.** Both `stream:true` (JEXI's path) and
  `stream:false` reproduce the failure, so JEXI's SSE handling is not implicated.
- A stronger local model does not help: `qwen3:4b` also produced 0 tool calls at
  41, 15 and 6 tools. This is a small-model capacity limit, not a JEXI bug.

### The two gates that were suspected, and what is actually true

1. **Permission gate.** `code-write` / `code-run` are `risky`; the shipped `auto`
   and `coding` profiles block them, so under those profiles the model's calls
   are rejected (`needs risky permission`). This is real but is **not** the
   binding constraint here, because under `full` (which permits them) the model
   still does not call them. The permission gate is a configuration boundary, not
   the cause of the zero.
2. **Intent routing.** An earlier run misclassified the task as
   `learning_research` and offered research tools. With the current harness query
   the intent is correctly `code_task` and the coding tools are offered. Not the
   cause of the zero.

### Schema repair makes no difference

`lib/schema-patch.mjs` repairs the empty domain-tool parameter schemas (a real
wiring bug documented in `README.md`). It changes the *contents* of the schemas,
not the *number* of tools offered (still 41), so it does not change the score:
**0/15 either way.** The schema bug is real but is masked by the larger
tool-count/capacity effect for this model.

## What this result is and is not

- **Is**: a real, reproducible, externally graded measurement of JEXI's shipped
  agent loop driving a specific small local model. It is a floor, honestly
  labelled with the model identity in every manifest.
- **Is not**: a claim about JEXI with a frontier tool-calling model. A capable
  model that reliably emits native tool calls under a large tool menu is the
  documented next measurement, and is expected to move this number.

## Reproduce

```bash
export DOTENV_CONFIG_QUIET=true MODEL_PROVIDER=ollama \
       OLLAMA_HOST=http://127.0.0.1:11434 MODEL_NAME=llama3.2:3b

node benchmarks/humaneval-live/run.mjs --leg gold   --tasks 10
node benchmarks/humaneval-live/run.mjs --leg jexi   --tasks 15 --schema as-shipped --profile full
node benchmarks/humaneval-live/run.mjs --leg jexi   --tasks 15 --schema repaired   --profile full

node benchmarks/humaneval-live/report.mjs   # renders every result in results/ to one table
```

Run legs **one at a time**. Ollama serves one model on one CPU; concurrent runs
contend for it and inflate every task's wall-clock time.

## M12 — the narrowing was done, and tool adoption flipped

M11 named the highest-leverage change as narrowing the offered menu for a coding
turn. M12 implemented it. Same harness, same model (`llama3.2:3b` via local
keyless ollama), same 15 tasks, same `--profile full`:

| leg | offered menu | tasks that called a tool | result |
|---|---|---|---|
| M11 jexi, as shipped | 41 tools | **1/15** | **0/15 = 0.0%** |
| M12 jexi, as shipped | 8 tools | **14/15** | **7/15 = 46.7%** |

Raw evidence: `results/humaneval-jexi-as-shipped-2026-10-31T16-59-19-811Z.json`.
Per-task tool calls in the M12 run: `[7,12,1,1,5,1,7,1,6,8,5,1,0,1,1]`.

The M11 failure was **never calling a tool** (`tools=0` on 14/15). After M12, 14
of 15 tasks make at least one real tool call. The failures that remain are
ordinary wrong-answer failures and one 300s timeout, not "answered in prose and
never touched the file".

### The three defects that were actually blocking it

None of these was a model-capability problem; all three were silent.

1. **The coding cap never engaged.** `isCodingIntent` matched
   `code`/`coding`/`fix`/`debug`/`refactor`/`test`, but the Planner emits
   `code_task`/`code_fix` — so the cap returned false for every real coding
   turn.
2. **Domain tools reached the model with EMPTY argument schemas.**
   `resolveToolDef` synthesised a bare `{slug,name,permission}` stub for domain
   tools, dropping the `parameters` they already declare. The model was told
   `fs_write` existed but not that it needs `path` and `content`, so it could
   not form a valid call. This is the "offering half" of JEXI-017; M11 saw the
   symptom but it was masked by the 41-tool menu. Fixed by publishing
   `getDomainTool` on the domain probe and passing a native JSON-Schema
   `parameters` through `buildNativeSchemas`.
3. **An unmapped intent fell back to the FULL catalogue.** Disclosure was gated
   on the LLM intent label; a coding task the classifier labelled
   `observability` matched no bundle and silently received all 24 tools. A
   universal `filesystem`+`terminal` floor now applies to any unmapped intent;
   an explicit `[]` mapping still means "no disclosure".

### A measurement trap worth recording

An early M12 run reported **12/15 = 80%** — on the **keyless network ladder**,
not llama3.2:3b. `run.mjs` uses the network ladder unless
`MODEL_PROVIDER=ollama OLLAMA_HOST=… MODEL_NAME=…` are exported, and records
`model: provider-ladder (keyless floor: kilo/pollinations)` in the manifest when
they are not. That number is **not** comparable to the M11 baseline and is not
reported as an M12 result. Always read `manifest.model` before comparing.

A second trap: a resumed sandbox has no ollama, and installing only the
`ollama` binary (not `lib/ollama/llama-server`) makes every generation 500 in
~3s. A batch of ~3s zero-tool failures is a dead provider, not an agent
regression.

### Reproduce

```bash
export DOTENV_CONFIG_QUIET=true MODEL_PROVIDER=ollama \
       OLLAMA_HOST=http://127.0.0.1:11434 MODEL_NAME=llama3.2:3b \
       BENCH_MODEL=llama3.2:3b
node benchmarks/humaneval-live/run.mjs --leg jexi --tasks 15 --timeout 300 \
     --schema as-shipped --profile full
```

`--timeout 300` (seconds) is needed: real tool use makes each task take 1–5
minutes on one CPU, and the 150s default truncates work mid-task.
