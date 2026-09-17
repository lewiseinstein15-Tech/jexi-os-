---
id: angular
loads: stack
---

# Angular Rules

[JEXI-RULE angular AN-1] Standalone components by default; NgModules only for legacy interop.

[JEXI-RULE angular AN-2] `OnPush` change detection for new components.

[JEXI-RULE angular AN-3] Inject dependencies via `inject()` or constructor parameters — never instantiate services by hand.

[JEXI-RULE angular AN-4] Every RxJS subscription is managed: `async` pipe or `takeUntil`. No orphan subscriptions.

[JEXI-RULE angular AN-5] Templates stay logic-light; branching belongs in the component class.
