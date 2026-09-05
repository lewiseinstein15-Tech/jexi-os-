# Research: Puro-2B — future understanding only

> Studied 2026-09-05 from the paper (arXiv:2608.27370, "Puro-2B: Poor Lab's
> Qwen2-1.5B Trained on RTX 5090 within $5090") and the training repository
> (thu-pacman/Puro-Megatron, Megatron-LM adaptation, Apache-2.0 recipe).
> **Research only — JEXI does not and will not train or host models.**

## What the paper shows

- An OPEN pretraining recipe: a 2B-class model from scratch on up to 1.4T
  tokens, FP8 precision, consumer RTX 5090 GPUs, best variant under $6.9K
  total compute cost, approaching Qwen2.5-1.5B under their protocol.
- Cost efficiency comes from: hardware selection, low-precision training,
  hyperball optimization, curriculum model averaging, and the data recipe.
- **Puro Cost Scaling Law** — fitted law relating training cost to average
  model performance (~$4.4K suffices to match Qwen2-1.5B in their setup).
- A controlled study of how pretraining data curricula shape downstream
  performance after post-training — possible because they release the FULL
  pipeline (data, code, weights, Apache 2.0).

## Why this matters to JEXI (indirectly)

1. **Benchmark methodology** — their evaluation protocol and cost-scaling
   framing reinforce JEXI's own rule: capability claims must be measured,
   versioned, and tracked over time (AGI_BENCHMARK.md). Their "collection of
   models differing in budget/recipe" mirrors JEXI's benchmark-over-time
   table.
2. **Curriculum concepts** — ordering learning material by difficulty maps
   to JEXI's phased capability growth (each phase adds an axis to the
   benchmark before claiming it).
3. **Checkpointing discipline** — resumable, fault-tolerant training runs
   parallel JEXI's mission-resume guarantees (WorkGraph SIGKILL-resume).
4. **Future optionality** — IF remote providers ever became untenable and
   tiny local models became genuinely useful for narrow sub-tasks, an open
   recipe like Puro documents how that could be done cheaply. That day is
   explicitly NOT today, and the mission spec forbids local hosting — this
   paragraph is understanding, not intent.

## Explicit non-goals

No training runs, no model downloads, no GPU requirements, no local inference
servers in JEXI. Nothing from Puro-Megatron enters the codebase.
