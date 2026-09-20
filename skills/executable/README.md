# Executable Python skills — Scope H

A Python-backed skill is a self-contained package:

```text
skills/executable/<skill-name>/
  SKILL.md
  skill.py
  README.md  # optional
```

`SKILL.md` must have canonical frontmatter for `name`, `description`,
`whenToUse`, `allowedTools`, and `version`, followed by a `## Prompt Defense
Baseline` heading. `skill.py` must expose the frontmatter `callable` (default
`run`) and receive one JSON-compatible argument object.

```js
import { pythonSkill } from './python-skill.js';
const loaded = pythonSkill.load('skills/executable/test-hello');
const ran = await pythonSkill.run('skills/executable/test-hello', { name: 'world' });
```

The runner imports `skill.py` with CPython `-I -B`, runs it from its own skill
directory, captures stdout and stderr separately, and defaults to a 30-second
wall-clock timeout. `run()` accepts an optional third `{ timeoutMs }` argument.
The isolated working directory is not a hostile-code sandbox. No library skill
is changed or rerouted by this additive loader.
