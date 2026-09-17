---
id: vue
loads: stack
---

# Vue Rules

[JEXI-RULE vue VU-1] Composition API with `<script setup>` for all new components.

[JEXI-RULE vue VU-2] Declare prop types and requiredness; declare every emitted event with `defineEmits`.

[JEXI-RULE vue VU-3] Never mutate props. Emit up, compute down.

[JEXI-RULE vue VU-4] `computed` for derived values; do not cache derived data in `ref` by hand.

[JEXI-RULE vue VU-5] `v-for` needs a `:key`; `v-if` and `v-for` never sit on the same element.
