---
id: swift
loads: stack
---

# Swift Rules

[JEXI-RULE swift SW-1] Handle optionals at entry with `guard let` / `if let`. No force unwraps (`!`) in app paths.

[JEXI-RULE swift SW-2] Value types (`struct`) by default; `class` only for identity or reference semantics.

[JEXI-RULE swift SW-3] Break ARC retain cycles: `weak` / `unowned` on closure and delegate captures.

[JEXI-RULE swift SW-4] `async/await` for concurrency; no detached tasks without a stated reason.

[JEXI-RULE swift SW-5] Explicit access control — `private` by default, widen deliberately.
