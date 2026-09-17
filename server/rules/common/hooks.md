---
id: common/hooks
loads: always
---

# Lifecycle Hooks — Common

[JEXI-RULE common/hooks HK-1] Hooks are cheap (target < 100 ms), scoped to one side-effect domain, and never throw — they communicate through exit codes.

[JEXI-RULE common/hooks HK-2] A hook that does not fire on its real event is not wired. Prove wiring with a live trigger, not by reading the registration file.

[JEXI-RULE common/hooks HK-3] Exit 2 blocks the action; exit 0 allows it. When blocking, print a one-line reason the operator can act on.

[JEXI-RULE common/hooks HK-4] Hooks are deterministic: same input, same verdict. No network calls in blocking paths.

[JEXI-RULE common/hooks HK-5] Lifecycle events are registered explicitly — PreToolUse, PostToolUse, Stop, SessionStart, SessionEnd, PreCompact. No implicit magic.

[JEXI-RULE common/hooks HK-6] Hook failure degrades to allow-and-log, unless the hook is a guard (dev-server blockers, quality gates) — guards fail closed.
