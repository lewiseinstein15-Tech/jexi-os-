---
id: common/performance
loads: always
---

# Performance — Common

[JEXI-RULE common/performance PF-1] Measure before optimizing, and name the metric you improved. No metric, no optimization.

[JEXI-RULE common/performance PF-2] Per-request allocation is the default suspect in hot paths; hoist what does not change.

[JEXI-RULE common/performance PF-3] Stream instead of buffer for anything unbounded: logs, files, LLM output.

[JEXI-RULE common/performance PF-4] Bound every cache and every queue. Unbounded growth is a delayed outage.

[JEXI-RULE common/performance PF-5] On memory-constrained sandboxes (4 GB), kill residual gradle daemons and vite dev servers before builds — OOM discipline.

[JEXI-RULE common/performance PF-6] N+1 fetch patterns are a design smell; batch at the boundary.
