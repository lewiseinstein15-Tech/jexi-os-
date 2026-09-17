---
id: react-native
loads: stack
---

# React Native Rules

[JEXI-RULE react-native RN-1] `FlatList` / `SectionList` for long lists — never `.map()` over large arrays in render.

[JEXI-RULE react-native RN-2] Styles via `StyleSheet.create`; no fresh inline object literals inside render loops.

[JEXI-RULE react-native RN-3] Native module changes require a full clean rebuild — a JS reload does not load native code.

[JEXI-RULE react-native RN-4] After web bundle changes: run `npx cap sync android` AND verify the new bundle hash inside android assets before gradle — silent sync failure shipped broken APKs twice (v0.9/v0.10).

[JEXI-RULE react-native RN-5] Request permissions at point-of-use with a rationale; handle denial as a first-class state.

[JEXI-RULE react-native RN-6] Verify layouts on the 390×844 phone viewport; respect safe-area insets for top HUD and bottom composer.
