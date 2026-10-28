# JEXI OS — agent memory

Git workflow — two modes, both in active use:
1. **Direct mode** (early single-agent phases): commit straight to `main`,
   push direct to main.
2. **Branch mode** (multi-agent phases, current standard): each agent works a
   dedicated `phase-<n>-<builder>` branch (or `cleanup/*` for hygiene passes),
   ONE commit per scope, cross-verified by a different agent, merged to
   `main` with `--no-ff` after the final gate. Rollback tags `pre-phase-<n>-*`
   / `post-phase-<n>-merge` bracket every merge.

Git token lives in `.jexi-secrets/git-token` (oauth2 form). Raw tool output
only, no prose narratives in commits.

## Verification subsystem (`server/src/verification`)

- Verifiers are executable verifiers invoked by WorkGraph `VerificationNode`s.
- Phase 5 Scope B: Test/Build/Lint verifiers spawn **real commands** via
  `src/verification/spawn/execute.js` (`runCommand`, `resolveBin`, `resolveConfiguredCommand`).
  - `options.run` (a function) remains the deterministic test seam.
  - No configured command → `status: 'error'` — NEVER a canned pass.
- Configured commands live in `package.json` under `jexi.verify.{lint,test,build}`.
- Snapshot sandbox (`spawn/sandbox.js`): `materialize: true` copies the frozen
  snapshot files into an OS tempdir and runs the child there; **off by default**
  because real project commands need `package.json` + `node_modules` in cwd.
  The snapshot contract is honored at the evidence layer (every record pins
  `snapshotId`; FileStateVerifier byte-compares against the frozen files).
- `FileStateVerifier` does real byte compare; mismatches produce a line diff
  via `verifiers/diff.js` (self-contained LCS, no external `diff` binary).
- `AgentVerifier` routes the reviewer through the workforce registry
  (`resolveAgent` from `workforce/registry/router.js`, `getByAgentId` from
  `workforce/registry/index.js`, legacy fallback `getAgent` from `services/AgentRoster.js`),
  refuses same-agent verification, and dispatches a real review through
  `services/SubagentRuntime.js`. No LLM provider → honest `'error'`.
- Auto-verify loop (`loop/auto-verify.js`): injected `layers.*` fns are the
  deterministic seam; with zero injected layers it hooks the REAL cheapest
  layer ('lint' on the edited files) so an ordinary edit path gets real
  verification. First failure stops the loop; the structured failure is
  injected back as `context.injectedFailure`.
- Work graph: `runVerificationNode(nodeId, {...})` on the graph API imports
  `VerificationRunner` from `src/verification/index.js`, calls it with the
  verification node's `verifiesNodeId` claimant as `claimantAcbId`, completes
  the node with evidence on pass, marks it failed + returns `injectedFailure`
  on fail/error. Task completion stays gated on `verification_pending` /
  `verification_no_evidence` until the verification node is completed.

## TUI (`interfaces/cli/lib/tui`)

- `jexi tui` opens a full-screen TUI; needs a TTY (refuses pipes with exit 2).
- Layout is PURE: `render.composeView(t, {cols, rows, scroll, input, busy, model, header})`
  returns exactly `rows` lines. All view math is testable without a TTY.
- `rows.js` is the bridge between the backend's flat /api/chat vocabulary
  (`stream`, `think`, `log`, `plan`, `tool_use`, `team`, `command`, `done`) and
  the Phase 16 taxonomy (`message.delta`, `tool.started`, …). It accepts BOTH.
- Tool rows merge IN PLACE by `id` (running → success/error is one row), which is
  why `tool_use.id` must be forwarded unchanged.
- `readKeys` buffers BYTES, not strings: a multi-byte char split across stdin
  chunks is otherwise destroyed by per-chunk `toString`. Same for escape
  sequences split across chunks.
- Frame writer emits alt-screen + one home-cursor write inside a
  synchronized-update block (`\x1b[?2026h…l`) with clear-to-EOL per line.
  Never `stripAnsi` a frame — it would drop the theme colors.
- No provider configured → the turn FAILS honestly (`turn-end-fail`). Never
  substitute a canned answer.

## Keyless gateway legs (provider ladder)

- Two keyless legs sit at the very bottom of every ladder, above nothing:
  `kilo` then `pollinations`. Both are always "configured"; neither may ever
  LEAD a worker chain (`WorkerRouter.runtimeChain` filters them from `top`).
- **Kilo Gateway** (`kilo`, B-KILO) — `https://api.kilo.ai/api/openrouter`,
  the endpoint behind `github.com/AnganSamadder/openkilo`. Re-serves the
  OpenRouter catalog; 400 models, 12 free, 11 of the free ones tool-capable
  (context up to 1M). Live-verified 2026-10-27: keyless chat, native tool
  calling, streaming, 5/5 parallel, no per-IP 30s limiter.
  - **Quota**: the keyless tier is a *global per-IP* promotion limit
    (`429 PROMOTION_MODEL_LIMIT_REACHED`), not per-model — exhausting it
    blocks every model until it resets. Set `KILO_API_KEY` to lift it.
  - **Load-bearing quirk**: the keyless tier REJECTS a dummy bearer
    (`401 INVALID_TOKEN`). The `Authorization` header must be OMITTED, not
    blanked — hence `authHeaders()` in LLMClient and `allowEmptyKey` on
    `tryOpenAICompat`. `''` is a valid, intended key here. Every `!cfg.key`
    guard on the ladder must exempt `kilo` (both the streaming and tool paths).
  - This is why kilo sits ABOVE pollinations: pollinations is text-only
    (`gen.pollinations.ai/v1` now 401s for tools), kilo is tool-capable.
- `KILO_API_URL` / `KILO_API_KEY` are the env seams (base-URL override + an
  optional key that only raises the rate limit).

## Testing

- `tests/agi/test-verification-independence.js` — Scope D determinism suites.
- `interfaces/cli/test-tui.js` — TUI suites (39 checks): ansi primitives, the
  wire→row map for the real emitted vocabulary, the transcript reducer, frame
  composition at four sizes, key decoding incl. split sequences, the frame
  writer, and a full headless app loop over a fake backend + fake stdin.
  Wired into `server/package.json` test chain after `test-cli.js`.
- `tests/agi/test-verification-spawn.js` — Phase 5 Scope B REAL-spawn suites
  (uses `tests/agi/fixtures/verify-pkg`, a self-contained fixture package;
  `src/plain-sum.js` is a plain assertion script that exits nonzero — use it,
  NOT `node --test`, as the child command when running inside the parent
  `node --test` harness, because nested `node --test` silently skips due to
  the parent runner's recursion guard).
- `scripts/scope-b-probe.mjs` — live probe printing raw JSON lines; run with
  `DOTENV_CONFIG_QUIET=true node scripts/scope-b-probe.mjs` to silence dotenv
  tips. Do NOT run real `node --test` as a child under the test harness.

## Installer (`interfaces/cli/install.sh`, `install.ps1`)

- Installs to `~/.jexi/repo`, backend deps, and a `jexi` shim on PATH.
- Node requirement is **22.5+**, not 20 — the backend imports `node:sqlite`
  (`DatabaseSync`), which landed in 22.5. `install.sh`, `install.ps1`, and
  `doctor.checkNodeVersion` all enforce the minor version.
- The CLI lives at `interfaces/cli/`, so every installer path is
  `interfaces/cli/jexi.js`. The documented one-liner URL and the symlink/shim
  target must both use that prefix.
- Verify a change with a throwaway HOME:
  `HOME=$(mktemp -d) bash interfaces/cli/install.sh` then run the shim.

## Capability registry (`server/src/capability/registry`)

- Four-state model: `exists` → `registered` → `available` → `succeeded`.
  `available` = registered AND has an engine AND permitted by the ACTIVE profile;
  `succeeded` = a real, non-refused success in the outcome ledger. Never assert a
  state — derive it. `describeCapability(id, { profile })` returns the reason.
- `requirements.js` infers what the REQUEST needs from its own words, decoupled
  from `Planner._classify`. A requirement is `explicit` (from the request's
  words) or an intent default; only explicit ones outrank the coding cap and a
  skill's allowlist.
- `selection.js` offers a MINIMAL set (one provider per capability) and only
  slugs that resolve AND have an engine. `expandAll: true` for the full set.
- `ledger.js` distinguishes `succeeded` / `refused` / `failed`. A transport-ok
  result with a failing VERDICT is a failure; a refusal is not a failure.
  Wired into `AgentLoop` right after `executeTool`.
- `capabilityPromptBlock()` (`services/CapabilityPrompt.js`) generates the
  prompt section; `capability_check` (control-plane, always reachable) answers
  "can you do this?" from the runtime.

## Gotchas

- **Tool discovery is a function of the request, not the classifier.**
  `plan.tools` comes from the classified intent via `toolsForTeam`, so a misroute
  silently withholds the right tools. `ToolSetBuilder` step 1b merges the
  required capabilities in afterwards — if you remove that step, "run ls -la in
  the terminal" is offered 36 tools with no terminal among them.
- **`resolveToolDef` returns a probe stub WITHOUT `riskLevel` for domain tools**
  (`{slug,name,desc,permission}`). `def.riskLevel ?? 'medium'` therefore maps
  every domain tool to `medium` and `readonly` denies `fs_read` (declared
  `'low'`). Read risk from `tools/registry/ToolRegistry.js` `getTool`, which is
  the definition the domain executor actually gates on.
- **Two tool registries.** `services/ToolRegistry.js` (legacy, `TOOL_REGISTRY`)
  and `tools/registry/ToolRegistry.js` (domain). `resolveToolDef` consults the
  legacy one and falls back to a domain probe. They disagree on shape — check
  which one you need.
- **`debugging` skill's `allowedTools` is prose, not slugs**
  (`["read","edit","terminal.execute","testing.run"]`). `ToolSetBuilder` now
  refuses to narrow by an allowlist with no resolvable entry and logs a warning.
  The skill data is still wrong; fixing it is the right follow-up.
- `term_execute` is DEGRADED in the dev container: `unshare: write failed
  /proc/self/uid_map: Operation not permitted`. The engine reports the real
  stderr and marks the sandbox `degraded` rather than faking success. Do not
  write a test that assumes the command runs — assert the honesty instead.
- **Mutation-test new checks.** A test that passes before and after a fix proves
  nothing. Break the fix, confirm the check fails, restore. The evaluation
  scenarios in `evaluation/capability-tasks.js` were validated this way.

## Evaluation

- `node evaluation/run.js` (from `server/`) — the full suite, gates at 0.90.
  6 original categories plus `capability-runtime` (`evaluation/capability-tasks.js`,
  13 scenarios covering the agent-runtime mission: task completion, tool
  selection, execution success, verification quality, false-success claims).
  Appends a dated row to `evaluation/RESULTS.md`.
- **Never construct a `readline` interface on `process.stdin` at module load.**
  The wizard did (`const _tty = … ? createPrompter() : null`), which opened a
  handle that kept the event loop alive, so EVERY command (`jexi help`,
  `jexi version`, `jexi tui`) printed its output and then hung until Ctrl-C
  whenever stdin was a TTY. Build it lazily on first prompt instead. Piped
  stdin hid the bug completely — it only reproduced on a real terminal.
- To test a command that needs a TTY, use a pty and reap the child after EIO
  (`python3 -c 'import pty; pty.fork()'` or `script`); a bare pipe or
  `</dev/null` will silently pass the buggy path.
- `node --test` recursion: a child `node --test` inside a parent `node --test`
  process exits 0 immediately (`node:test run() ... recursively ... skipping`),
  which would make a failing test look like a pass. Use plain assert scripts
  or `run-from-cwd.js` for child verifier commands under the harness, and only
  real `node --test` outside it (e.g. in the live probe).
- `DOTENV_CONFIG_QUIET=true` suppresses the `dotenv` tips that pollute stdout.
- Bespoke HTTP/token rules: push direct to main (see the PUSH note below for the
  credential that currently works).
- PUSH — RESOLVED (2026-09-15): `.jexi-secrets/git-token` was replaced with a
  credential holding Contents: write on this repo; `git push origin main` works
  again via the `oauth2:<token>` form. Scope A (local `34ca9bb`) is on remote
  main. The earlier blocker was an App installation token with no Contents
  write (every form 403 / "Resource not accessible by integration"); no repo or
  App permission change was needed, only the token file.
  - Commit-only flow, direct to `main`. Do NOT create branches/PRs.
- PUSH — CURRENT (2026-10-28): `.jexi-secrets/git-token` is now MISSING (401)
  and the token baked into `origin`'s URL is expired (push prompts for a
  password). The working credential is `$GITHUB_TOKEN` (has `push: true` on this
  repo). Push with a one-shot helper so the token is never written to config:
    `git -c credential.helper='!f(){ echo username=x-access-token; echo password=$GITHUB_TOKEN; };f' \
       push https://github.com/lewiseinstein15-Tech/jexi-os-.git main:main`
  Then `fetch origin main` to refresh the tracking ref (an explicit-URL push
  does not update it).
  - CONFIRMED 2026-10-27: the inline-URL form works too and needs no helper:
    `git push "https://oauth2:${GITHUB_TOKEN}@github.com/lewiseinstein15-Tech/jexi-os-.git" main`
    followed by `git fetch <same-url> main:refs/remotes/origin/main`. Set `GIT_TERMINAL_PROMPT=0` so a bad credential fails
  fast instead of hanging on a password prompt.
- `$HOME` is load-bearing for the CLI (`~/.jexi`, `~/.local/bin`). If you export
  `HOME` to sandbox a test, EXPORT IT BACK (`export HOME=/home/openhands`)
  before committing — a stray `HOME` breaks `git config` identity lookup.