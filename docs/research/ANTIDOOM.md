# Research: Antidoom (Liquid4All/antidoom) — runtime adaptations only

> Studied 2026-09-05 from the repository README. Antidoom is a TRAINING tool:
> it generates preference data and trains LoRA adapters (Final Token
> Preference Optimization) to reduce model repetition loops ("doom loops").
> **It is not a runtime dependency and will never be one** — JEXI does not
> host or train models (mission constraint §0).

## What Antidoom does

- Samples completions from a model, detects where a repeated span begins,
  marks the first loop-starting token as rejected, picks coherent alternative
  tokens, and trains a LoRA adapter with FTPO so the model prefers not to
  enter the loop. Adapts the Antislop single-token preference idea to
  runaway repetition during reasoning.

## Why doom loops happen (their analysis — directly useful to JEXI)

1. **Overtrained tokens** — reasoning tokens ("Wait", "So", "But",
   "Alternatively") become attractors under uncertainty.
2. **Self-reinforcing context** — once a short sequence repeats, the context
   makes it more likely to repeat again, climbing toward certainty.
3. **Low-temperature sampling** — no natural escape route from a locally
   reinforced loop.

## What JEXI can adapt WITHOUT training (runtime detection)

JEXI controls its own loops, not the model weights. Runtime equivalents:

1. **Repeated tool calls** — hash (tool, arguments); N identical calls with
   identical failing results = loop → break, classify, escalate to replan.
   JEXI already has failure ladders; add exact-repetition detection to them.
2. **Repeated failed actions** — same command, same exit code, same stderr
   signature ≥3× → stop retrying, generate a hypothesis instead (Phase 7).
3. **Repeated reasoning states** — if consecutive model turns produce
   near-identical outputs (similarity above threshold), break the loop:
   change strategy, temperature, provider, or surface to the user.
4. **Circular plans** — WorkGraph makes cycles visible: an item that unblocks
   → re-blocks → unblocks the same dependency is a cycle; detect and replan.
5. **Identical requests** — request deduplication (Phase 1) is the preventive
   form: the same request never re-executes concurrently at all.
6. **Infinite agent loops** — mission budgets (maxItems, maxFailures,
   wallClock) already bound this; add loop-signature detection so the failure
   reason says "repetition loop" instead of just "budget exhausted".

## Implementation note

These are deterministic, keyless, testable detectors — they belong in the
failure-recovery layer (Phase 7) and benchmark robustness axis, not in any
model path. No Antidoom code, models, or datasets enter JEXI.
