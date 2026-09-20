# superpowers — hooks enforcement layer

Ported from `obra/superpowers` @ `5bf4e78011075bcfc0dc295f0724994cd123ee71` (MIT).
This is a **bundled library artifact**: it ships inside the skill bundle, the
same way the skills do. It is **not** registered in JEXI's own hook table and
does **not** run in the kernel today.

## What upstream ships

| File | Role |
| --- | --- |
| `hooks.json` | Claude Code hook manifest — one `SessionStart` matcher (`startup\|clear\|compact`) invoking `run-hook.cmd session-start` over the `bash` shell. |
| `hooks-cursor.json` | The Cursor variant of the same manifest — `version: 1`, `sessionStart`, invoking the runner directly. |
| `run-hook.cmd` | Cross-platform polyglot runner. On Windows `cmd.exe` runs the batch block, which locates Git Bash and delegates; on Unix the `:` no-op line lets the shell fall through to `exec bash <script> "$@"`. Upstream deliberately uses extensionless hook script names so Windows auto-detection does not prepend `bash`. |
| `session-start` | The one hook script. Reads `skills/using-superpowers/SKILL.md` and emits it as session-start context, choosing the output field the detected platform consumes (`additional_context` for Cursor, `hookSpecificOutput.additionalContext` for Claude Code, `additionalContext` for the SDK-standard/Copilot path). |

The enforcement idea is the same one JEXI already implements in Phase 12 D:
the agent's own intent is not trusted, a precondition is checked at the action
boundary, and the action is blocked when it fails. Upstream expresses it as a
session-start context injection; JEXI expresses it as hard gates.

## Layout and the two authored files

The bundle mirrors upstream's plugin layout, because the hook script resolves
its own paths relative to the plugin root:

```
superpowers/
  skills/<slug>/SKILL.md     <- 15 skills
  hooks/
    hooks.json               <- ported verbatim
    hooks-cursor.json        <- ported verbatim
    run-hook.cmd             <- ported verbatim
    session-start            <- ported verbatim (bash, upstream original)
    run-hook.sh              <- AUTHORED: POSIX-sh runner
    session-start.sh         <- AUTHORED: POSIX-sh rendering
    README.md                <- AUTHORED: this file
```

`run-hook.sh` and `session-start.sh` are authored by this scope, not ported.
They exist so the layer is runnable and testable under `/bin/sh` on a host
without bash. `run-hook.sh` keeps upstream's contract: resolve the named
script relative to its own directory, `exec` it with the remaining arguments,
and exit 1 with a message when the name is missing or unknown. `session-start.sh`
keeps upstream's behaviour and its platform field selection; the only change is
the JSON escaping, which swaps bash's `${var//old/new}` for a `sed` pipeline so
a pure POSIX shell can run it.

## Mapping onto JEXI Phase 7 B

| Upstream | JEXI Phase 7 B equivalent | Status |
| --- | --- | --- |
| `hooks.json` → `hooks.SessionStart[].matcher` | `hooks/hooks.json` → `hooks[].event: "SessionStart"` | same event, different schema — not wired |
| `hooks[].type: "command"` + `command` | `hooks[].command` | not wired |
| `hooks[].async: false` | Phase 7 B is synchronous per hook, no `async` field | not wired |
| (no exit-code contract; always exits 0) | `exitBehavior: "block" \| "warn"` + `timeout` | JEXI's contract is richer |
| `run-hook.cmd <name>` | `node hooks/scripts/<event>/<name>.js` | different runner; both take a JSON context on stdin |
| hook input via stdin JSON | hook input via stdin JSON | same |

**To wire this later** (a zone-owner task, explicitly out of this scope):
convert each entry in `hooks/hooks.json` into a Phase 7 B entry with an `id`, an
`exitBehavior` and a `timeout`; point `command` at
`sh skills/library/claude-ecosystem/superpowers/hooks/run-hook.sh session-start`;
and choose `warn` as the exit behavior, since upstream's hook always exits 0 and
session-start context is an informational injection rather than a block.

## What is NOT VERIFIED

- The layer is not registered in `hooks/hooks.json`, so no JEXI event actually
  triggers it. Nothing here has run inside the kernel.
- Upstream's Windows `cmd.exe` path is unexercised — no Windows host here.
- The platform-detection branches (Cursor / Claude Code / Muse / Copilot) are
  selected by environment variable. The default and Claude Code branches were
  exercised directly; the Cursor, Muse and Copilot branches were not, because
  none of those hosts exist in this sandbox.
