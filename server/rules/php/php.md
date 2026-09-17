---
id: php
loads: stack
---

# PHP Rules

[JEXI-RULE php PHP-1] `declare(strict_types=1)` at the top of every file.

[JEXI-RULE php PHP-2] PSR-12 style; composer autoload — no `require_once` chains.

[JEXI-RULE php PHP-3] Types on parameters and returns; `mixed` only with a comment justifying it.

[JEXI-RULE php PHP-4] Prepared statements for every query. String interpolation into SQL is a vulnerability, not a shortcut.

[JEXI-RULE php PHP-5] Never echo unsanitized input; escape on output with the context-correct function.
