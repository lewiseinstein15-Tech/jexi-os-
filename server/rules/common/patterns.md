---
id: common/patterns
loads: always
---

# Patterns — Common

[JEXI-RULE common/patterns PT-1] Composition over inheritance. Inject dependencies; do not import singletons from deep layers.

[JEXI-RULE common/patterns PT-2] Fail fast at the boundary, coerce once, pass typed values inward. No repeated defensive checks per layer.

[JEXI-RULE common/patterns PT-3] Use events for cross-cutting reactions (audit, UI updates) and direct calls for the core flow. Do not invert the two.

[JEXI-RULE common/patterns PT-4] Put an adapter at every external seam — providers, brokers, harnesses. The core never imports a vendor SDK directly.

[JEXI-RULE common/patterns PT-5] One source of truth per fact. Derived views recompute; they never store a second copy.

[JEXI-RULE common/patterns PT-6] Anything that retries must be idempotent, or retries multiply effects.

[JEXI-RULE common/patterns PT-7] Prefer boring, debuggable flow over clever abstraction. Cleverness must pay rent in saved complexity.
