# JEXI OS — agent memory

Commit-only flow: direct to `main`, no branches. Git token lives in
`.jexi-secrets/git-token` (oauth2 form). Raw tool output only, no prose
narratives in commits.

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

## Testing

- `tests/agi/test-verification-independence.js` — Scope D determinism suites.
- `tests/agi/test-verification-spawn.js` — Phase 5 Scope B REAL-spawn suites
  (uses `tests/agi/fixtures/verify-pkg`, a self-contained fixture package;
  `src/plain-sum.js` is a plain assertion script that exits nonzero — use it,
  NOT `node --test`, as the child command when running inside the parent
  `node --test` harness, because nested `node --test` silently skips due to
  the parent runner's recursion guard).
- `scripts/scope-b-probe.mjs` — live probe printing raw JSON lines; run with
  `DOTENV_CONFIG_QUIET=true node scripts/scope-b-probe.mjs` to silence dotenv
  tips. Do NOT run real `node --test` as a child under the test harness.

## Gotchas

- `node --test` recursion: a child `node --test` inside a parent `node --test`
  process exits 0 immediately (`node:test run() ... recursively ... skipping`),
  which would make a failing test look like a pass. Use plain assert scripts
  or `run-from-cwd.js` for child verifier commands under the harness, and only
  real `node --test` outside it (e.g. in the live probe).
- `DOTENV_CONFIG_QUIET=true` suppresses the `dotenv` tips that pollute stdout.
- Bespoke HTTP/token rules: token from `.jexi-secrets/git-token`,
  `git config` uses oauth2 user (see git config in repo), push direct to main.
- PUSH BLOCKER (2026-09-14, Scope B): the only available tokens
  (`.jexi-secrets/git-token` = `oauth2` + `gho_...` GitHub App user token, and
  `$GITHUB_TOKEN` = `ghu_...`) are READ-ONLY for this repo: `git push` ->
  "Permission ... denied (403)", ref-update API -> "Resource not accessible by
  integration", repo-edit API -> same. API *reads* (contents, /user, repo
  permissions) work fine. Commit is staged on local main as `6365b46`;
  remote origin/main still at `f0722fb`. To unblock: grant the GitHub App
  `Contents: Read and write` on this repo, or provide a classic PAT with the
  `repo` scope, then `git push origin main`. Do NOT create branches/PRs.