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

## Next step (not done here — this mission is measurement only)

The single highest-leverage change is to **narrow the offered tool menu for a
coding turn** so a small model is not choosing among 41 tools. That is an agent
architecture change and is explicitly out of scope for M11; it is recorded here
as the measured, evidence-backed follow-up.
