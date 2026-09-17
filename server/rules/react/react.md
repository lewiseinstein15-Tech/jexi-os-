---
id: react
loads: stack
---

# React Rules

[JEXI-RULE react RC-1] Function components and hooks only. No new class components.

[JEXI-RULE react RC-2] Every dynamic list item carries a stable `key` — never the array index for mutable lists.

[JEXI-RULE react RC-3] Derived state is computed during render, not duplicated into `useState` and synced by `useEffect`.

[JEXI-RULE react RC-4] Every effect with a subscription, timer, or listener has a cleanup. No effect without a reason comment.

[JEXI-RULE react RC-5] Co-locate state at the lowest common owner; lift only when genuinely shared.

[JEXI-RULE react RC-6] `memo` / `useMemo` only after a measured render problem, not preemptively.

[JEXI-RULE react RC-7] Render only serializable values — coerce external objects before they reach JSX (React error #31 discipline).
