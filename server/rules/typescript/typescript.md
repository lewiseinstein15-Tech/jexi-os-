---
id: typescript
loads: stack
---

# TypeScript Rules

[JEXI-RULE typescript TS-1] `strict: true` is non-negotiable. No `any` — use `unknown` plus narrowing.

[JEXI-RULE typescript TS-2] Exhaustive switches over unions get a `never` guard in the default branch.

[JEXI-RULE typescript TS-3] Use `import type` for type-only imports; never pull values just to use their types.

[JEXI-RULE typescript TS-4] Interfaces for object shapes, discriminated unions for state machines.

[JEXI-RULE typescript TS-5] `tsc --noEmit` passes before commit. Compiler errors are not negotiable.

[JEXI-RULE typescript TS-6] No non-null `!` assertions outside tests. Prove it or guard it.
