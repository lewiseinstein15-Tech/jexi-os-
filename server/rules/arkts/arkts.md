---
id: arkts
loads: stack
---

# ArkTS (HarmonyOS) Rules

[JEXI-RULE arkts ARK-1] Every UI struct is decorated `@Component` (pages also `@Entry`); `build()` is the only render entry.

[JEXI-RULE arkts ARK-2] State flows through `@State` / `@Prop` / `@Link` — mutating non-decorated members never re-renders.

[JEXI-RULE arkts ARK-3] Strict typing per the ArkTS spec: no `any`, no untyped object literals outside declared interfaces.

[JEXI-RULE arkts ARK-4] Page routing via `router` with pages registered in `main_pages.json`.

[JEXI-RULE arkts ARK-5] Permissions declared in `module.json5` AND requested at runtime with a rationale.

[JEXI-RULE arkts ARK-6] Preview on a 390×844-class device profile; handle safe areas explicitly.
