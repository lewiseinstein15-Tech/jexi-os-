---
id: common/coding-style
loads: always
---

# Coding Style — Common

[JEXI-RULE common/coding-style CS-1] One responsibility per function. When a function grows a second unrelated branch-domain, extract it.

[JEXI-RULE common/coding-style CS-2] Names state intent. No single-letter names outside loop indices; booleans read as predicates (`isValid`, `hasAccess`).

[JEXI-RULE common/coding-style CS-3] Handle errors at the level that can act on them. Never swallow silently — an empty catch block is a bug.

[JEXI-RULE common/coding-style CS-4] Delete dead code instead of commenting it out. Version history remembers what you removed.

[JEXI-RULE common/coding-style CS-5] Comments explain WHY, never WHAT. If the WHAT needs explaining, rewrite the code first.

[JEXI-RULE common/coding-style CS-6] Small modules with explicit interfaces. No hidden global state crossing module boundaries.

[JEXI-RULE common/coding-style CS-7] Match the existing style of the file before imposing your own. Consistency beats preference.

[JEXI-RULE common/coding-style CS-8] No placeholder or stub returns. A function either does its job or fails honestly with an error.
