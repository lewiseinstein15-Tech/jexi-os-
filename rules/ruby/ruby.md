---
id: ruby
loads: stack
---

# Ruby Rules

[JEXI-RULE ruby RB-1] `# frozen_string_literal: true` in every file.

[JEXI-RULE ruby RB-2] RuboCop clean; follow the community style guide over personal taste.

[JEXI-RULE ruby RB-3] Prefer composition and modules over monkey-patching core classes.

[JEXI-RULE ruby RB-4] Use block-based File/IO so resources close deterministically.

[JEXI-RULE ruby RB-5] Raise real error classes with messages — never bare strings.
