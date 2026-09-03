# FIXLOG — B210: Employee Command Execution (the last §27 events, made real)

**Tests:** 48 new (test-b210.js) · **Suite:** full `npm test` SUITE_EXIT=0 (B210 chained after B209) · **Regressions:** B209 92/92, B208 89/89

B209's report closed every gap except COMMAND_*/TEST_* — skipped honestly because "no employee shell exists yet." B210 builds the shell, safely, so those events now come from **real execution**.

---

## What shipped

### 1. `CommandRunner.js` — an allowlisted executor, not a shell

Employees with the **EXECUTE** permission (Forge) can run commands **inside their own task workspace** (`jexi-workspace/director/<taskId>/` — the same place artifacts land). Six real safety layers:

1. **No shell** — `execFile(binary, args)`: pipes, `&&`, `$()`, redirects are *syntactically impossible*, not merely discouraged.
2. **Binary allowlist** — `node`, `python3`, `ls`, `cat`, `head`, `tail`, `wc`, `grep`, `echo`, `printf`, `diff`, `sort`, `uniq`. No `rm`/`mv`/`cp` (writes go through the artifact path), no network tools (search is a tool, not a shell), no package managers (arbitrary install scripts).
3. **Flag allowlist** — args may not start with `-` except `--test`, `-m`, `--version`, `-v` (covers `node --test` and `python3 -m pytest`; kills `node -e`).
4. **CWD sandbox** — every command runs in the task's own directory, which gets its own `{"type":"commonjs"}` package.json (without it, the server tree's ESM `package.json` breaks `require()` in employee scripts).
5. **Scrubbed env** — the B136 ShellEnv secrets scrubber (fail-closed by name pattern *and* value shape) builds the child environment; provider keys never reach employee code. Tested with a planted fake key.
6. **Bounds** — 30s timeout (SIGKILL), 16KB output cap with an explicit truncation marker, max 8 args, ≤4 commands per round, ≤2 rounds.

### 2. The command loop (real react-to-results)

The employee session's model phase is now a bounded loop. An employee puts requests in fenced blocks:

````
```run
node analysis.js
```
````

Each round: her artifact blocks land on disk **first** (so the scripts exist) → the commands really execute → `COMMAND_STARTED/COMPLETED/FAILED` (or `TEST_*` for recognized test invocations: `node --test`, `pytest`) fire with the real exit code, duration, and byte count → the actual output is appended to her prompt → she generates again, grounded in what really happened. Bounded at 2 rounds; permission denials (`PERMISSION_DENIED`, never executed) for employees without EXECUTE.

Forge's system prompt now includes the command briefing (CommonJS, allowed binaries, no shell features) **only** when she is staffed for `run-command`.

### 3. Two real bugs found on the way

1. **The B209 leak-masking corrupted code.** `sanitizeStreamText`'s unknown-id heuristic masks dotted tokens (`vendor.model`) — and `console.log` matched it, silently rewriting employee scripts to `Kai("SUM =", 102)` → `ReferenceError` at execution. New `sanitizeWorkProduct()`: prose gets the full mask, **fenced code blocks get known-id masking only** (a literal `gemini-2.5-flash` string in code is still masked; `console.log`, `Math.round`, `process.exit` are never touched). This was caught by the B210 tests because the command execution made the corruption *observable* — the script actually ran and failed.
2. **ESM inheritance.** The task workspace sits under `server/`, whose package.json is `"type":"module"` — `require('node:test')` died with "require is not defined in ES module scope". Each task dir now gets its own CommonJS package.json.

### 4. UI

`useJexiEngine` team states learn `COMMAND_STARTED/TEST_STARTED` → "executing" and the completion events → back to "working"; the log feed shows every command with its real verdict (`node analysis.js` → exit 0 in 84ms).

---

## Honest notes

- `python3` may not exist on every deploy target (the Render image is Node-based). When it's absent the command fails honestly with a COMMAND_FAILED the employee can see and adapt to (deliver JS instead) — availability is probed by reality, not assumed.
- The allowlist is deliberately tiny. Growing it is a decision, not an accident: every addition widens what employee-generated code can touch.
- `npm test`/`npm install` stay blocked on purpose: `npm run <script>` executes arbitrary script strings — that's a shell by another name.
