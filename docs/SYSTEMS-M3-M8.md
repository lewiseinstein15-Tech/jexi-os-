# JEXI Systems M3–M8 — operator & developer reference

Six systems, one rule each: **contracts refuse to spawn**, **prompts are
budgeted**, **builds teach builds**, **code is judged independently**,
**navigation is precise**, **pairing is proven**. Everything below is
covered by offline regression suites (see TEST.md).

## M3 — Professional agent contracts

- Definitions live in `server/agents/*.md`: YAML frontmatter (the
  machine-readable contract) + a specialist system prompt body.
- Required: `name` (kebab-case), `mission`, `allowed-tools` (non-empty,
  validated against the live tool registry), `delivers`, `completion`.
  Bodies under 200 chars are refused as shallow.
- `GET /api/agents/definitions` lists the validated roster (no prompt
  bodies leak).
- The spawn gate (`resolveJobAgent` in `SubagentRuntime.js`) blocks
  invalid/unknown contracts **before** any spawn; blocked jobs fail with
  the refusal reason. Suite: `test-agent-contracts.js` (26).

## M4 — Context compiler budgets + repo map

- `PromptAssembly.assemblePrompt` compiles named sections under a total
  budget (default 24k chars / 8k tokens): lowest priority drops first,
  `keep` sections (persona, instructions, tool SDK, policy) survive.
- `repoRoot` injects a bounded, mtime-cached workspace tree
  (`buildRepoMap`: depth/file/char caps, junk dirs skipped, manifest
  peeked). Pass `stats` to observe `{ chars, tokens, trimmed, kept }`.
- The autonomous coder maps its own staging area; compile stats ride
  home in `statistics.contextChars/Tokens/Trimmed`.
- Suite: `test-context-engine.js` (32).

## M5 — Coding recovery lessons

- After each autonomous build, tool evidence decides: errors + files
  delivered → `recovery` lesson; errors + nothing delivered → `failure`
  lesson; clean or provider-outage runs record nothing. Identical
  repeats dedupe (recurrence counter) instead of flooding the store.
- The next matching brief retrieves up to 2 past lessons into the
  system prompt; both injection and recording emit 📚 events.
- `statistics.lesson` (`failure`/`recovery`/null) + `lessonsInjected`.
  Suite: `test-recovery-lessons.js` (15).

## M6 — Independent judge gate

- `CodeJudge.js`: deterministic checks (file exists, non-empty, JS
  syntax via `node --check`, workspace-escape rejection) + `judgeVerdict`
  truth table — `PASS` / `FAIL` / `UNKNOWN`. No model verdict is
  `UNKNOWN`, never a fake pass; any failed check beats model approval.
- The coder runs reviewer + security passes best-effort after delivery;
  verdict + reasons land in the `gate` event, a summary line, `gate`,
  and `statistics.verdict`. No files → no gate (null).
- Suite: `test-judge-gates.js` (24).

## M7 — Code-intel tools

- The `lsp` tool (v1.1.0) adds `documentSymbols` (one file),
  `workspaceSymbols` (index-wide, optional query, truncation disclosed),
  and `diagnostics` (real JS errors with line numbers via the shared
  `diagnoseJsFile`; other languages honestly report `supported: false`).
- Suite: `test-code-intel.js` (19).

## M8 — Phone setup wizard

- First run with no stored key opens `SetupWizard` (brain address →
  live health probe → access key → live key verification → paired).
  Every step transition is earned by a probe; a keyless escape covers
  local brains. Completion persists URL + key.
- `GET /api/key/verify` is key-gated (200 = accepted, 401 = wrong key).
- Suite: `test-setup-wizard.js` (22).

## Verify quickly

```bash
cd server
node test-agent-contracts.js && node test-context-engine.js \
  && node test-recovery-lessons.js && node test-judge-gates.js \
  && node test-code-intel.js && node test-setup-wizard.js
```
