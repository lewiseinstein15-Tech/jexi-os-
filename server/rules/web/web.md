---
id: web
loads: stack
---

# Web (Vanilla JS/HTML/CSS) Rules

[JEXI-RULE web WB-1] Semantic HTML first. Div soup is a bug, not a style choice.

[JEXI-RULE web WB-2] Every interactive element is keyboard-reachable with visible focus.

[JEXI-RULE web WB-3] Defer non-critical JavaScript; nothing render-blocking in the critical path.

[JEXI-RULE web WB-4] Colors and spacing come from CSS tokens/variables — no magic hex values in component code.

[JEXI-RULE web WB-5] Escape user content; never assign raw input through `innerHTML`.

[JEXI-RULE web WB-6] Respect `prefers-reduced-motion` for any animation.
