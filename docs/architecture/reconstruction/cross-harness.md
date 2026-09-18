# Cross-Harness Adapters (Phase 7 H)

JEXI OS is not married to one coding harness. The canonical structure —
coworkers, rules, skills, hooks, commands, mcp — is converted into the
native format of 14 harnesses and installed wherever that harness lives
on the machine.

## Canonical input (JEXI OS)

| Source   | Path                                          | Notes                                  |
| -------- | --------------------------------------------- | -------------------------------------- |
| Agents   | `jexi-agents/coworkers/*.md`                  | front-matter: name, description, models |
| Agents   | `workforce/coworkers/*/agents/*.agent.js`     | canonical phase layout (when populated) |
| Rules    | `server/rules/{common,languages}/**.md`       | category = parent dir                  |
| Skills   | `skills/*.json` (and `*.skill.js`)            |                                        |
| Hooks    | `hooks/hooks.json`                            | 8 registered hooks (Phase 7 B)         |
| Commands | `commands/registry.js`                        | 12 commands + aliases (Phase 7 G)      |
| MCP      | `mcp/registry/local.json` → `mcp.example.json`| fallback order                         |

## The 14 harnesses

| id            | Harness        | Config dir          | Format   | Agents | Rules | Skills | Hooks | Commands | MCP |
| ------------- | -------------- | ------------------- | -------- | ------ | ----- | ------ | ----- | -------- | --- |
| claude-code   | Claude Code    | `~/.claude/agents`  | markdown | yes    | yes (CLAUDE.md) | no | yes (settings.json) | yes (commands/*.md) | yes (.mcp.json) |
| codex         | Codex          | `~/.codex/agents`   | markdown | yes    | yes (AGENTS.md) | no | no | no | no |
| cursor        | Cursor         | `.cursor/rules`     | mdc      | no     | yes (*.mdc) | no | no | no | no |
| gemini        | Gemini CLI     | `~/.gemini/agents`  | markdown | yes    | yes (GEMINI.md) | no | no | no | yes |
| opencode      | OpenCode       | `~/.opencode/agents`| markdown | yes    | yes (AGENTS.md) | no | no | yes | no |
| openclaw      | OpenClaw       | `~/.openclaw`       | markdown | yes (+SOUL.md) | yes (AGENTS.md) | no | no | no | no |
| aider         | Aider          | repo root           | markdown | no     | yes (CONVENTIONS.md) | no | no | no | no |
| windsurf      | Windsurf       | `.windsurf/rules`   | markdown | no     | yes (*.md) | no | no | no | no |
| copilot       | GitHub Copilot | `.github/copilot`   | markdown | no     | yes (instructions.md) | no | no | no | yes |
| kimi          | Kimi           | `~/.kimi/agents`    | markdown | yes    | no | no | no | no | no |
| hermes        | Hermes         | `~/.hermes/agents`  | markdown | yes    | no | no | no | no | no |
| osaurus       | Osaurus        | `~/.osaurus/agents` | markdown | yes    | no | no | no | no | no |
| antigravity   | Antigravity    | `~/.antigravity/agents` | markdown | yes | no | no | no | no | no |
| mistral-vibe  | Mistral Vibe   | `~/.mistral/agents` | markdown | yes    | no | no | no | no | no |

## File format per harness

- **claude-code** — one front-matter `.md` per agent (`name`, `description`);
  rules merged into `CLAUDE.md`; hooks as Claude `settings.json` shape
  (`hooks.PreToolUse[].matcher` + `hooks[].{type:command,command,timeout}`);
  one `.md` per slash command under `commands/`; MCP verbatim as `.mcp.json`.
- **codex / opencode** — same agent file shape; rules merged into `AGENTS.md`.
- **gemini** — same agent shape; rules merged into `GEMINI.md`.
- **openclaw** — agents rendered, plus `SOUL.md` (identity doc synthesized
  from the roster's self-descriptions) and `AGENTS.md` (merged rules).
- **cursor** — one `.mdc` per rule: front-matter `description`, `globs`,
  `alwaysApply` (common rules always-apply; language rules glob-filtered).
- **aider** — all rules merged into one `CONVENTIONS.md` at the repo root
  (read with `aider --read CONVENTIONS.md`).
- **windsurf** — one `.md` per rule under `.windsurf/rules/`.
- **copilot** — rules merged into `.github/copilot/instructions.md`.
- **kimi / hermes / osaurus / antigravity / mistral-vibe** — one
  front-matter `.md` per agent, nothing else.

## Usage

```bash
# convert everything to /tmp/jexi-harness-<id>/
scripts/convert-harnesses.sh

# see what would be installed on this machine (no writes)
scripts/install-harnesses.sh --dry-run

# install into every detected harness (idempotent)
scripts/install-harnesses.sh

# single adapter / controlled test root
scripts/convert-harnesses.sh --only claude-code
scripts/install-harnesses.sh --root /tmp/some-root --force
```

## Layout

```
harness/
├── adapters/
│   ├── _base.adapter.js     # shared contract + agent/rule presets
│   ├── _convert.js          # canonical collector (resilient, per-file errors)
│   ├── _install.js          # idempotent writer (dry-run aware)
│   ├── _cli.js              # CLI used by the two scripts
│   ├── index.js             # registry facade: list/get/detect/convert/install
│   └── *.adapter.js         # 14 adapters (one file per harness)
└── index.js                 # harness facade (re-exports adapters)
```

## Guarantees

- **Contract-validated**: every adapter is checked at load (id, format,
  supports matrix, convert/install/reader functions). A bad adapter fails
  fast at import time.
- **Idempotent install**: identical content is never rewritten; a second
  run reports `0 created, 0 changed` (no drift, no duplicates).
- **Clean skips**: undetected harnesses print `detected: false, skipped
  cleanly` — never a crash.
- **Error isolation**: a broken canonical file is reported with its exact
  path and reason; every other file and harness still converts (CI uses
  `--strict` to fail on canonical errors).
- **Round-trippable**: every adapter ships a `reader()` that parses its
  converted output back to canonical shape (verified by probe P7).
