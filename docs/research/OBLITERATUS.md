# Research note: OBLITERATUS — studied, deliberately not integrated

> Studied 2026-09-05 from github.com/elder-plinius/OBLITERATUS (8.2k stars).
> Repository shape: training/checkpoint infrastructure — distributed
> checkpoint intake and preflight, causal-LM evaluation, saved Qwen3.8
> checkpoint evaluation, HF Spaces deployment, notebooks, installer.

## Why it is not being integrated

OBLITERATUS is model-training/checkpoint tooling. It does not address any of
JEXI's actual problems:

- **Not API limits** — JEXI's provider-limit problem needs routing, health,
  budgets, caching, failover (roadmap Phase 1); a checkpoint pipeline is
  irrelevant to it.
- **Not provider failover / model routing** — no capability here.
- **Not MCP, planning, or agent architecture** — nothing to adapt.
- **Against the standing constraint** — JEXI does not host or train models
  (mission spec §0); anything whose center of gravity is local model
  weights/checkpoints is out of scope by definition.

No code, dependency, or artifact from OBLITERATUS enters JEXI. The only
takeaway is confirmatory: JEXI's constraints (remote intelligence, measured
capabilities, no local hosting) remain the right ones for this project.
