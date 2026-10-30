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

## Internal context boundary (M4-1)

- The brain-recall block (conversation hot-memory, brain pages, ontology,
  instincts — up to `BRAIN_TOTAL_BUDGET = 1500`) is INTERNAL prompt context.
  It is composed onto the coordinator node's query by
  `withCoordinatorContext` (`services/BrainRecall.js`), which now wraps it
  behind `INTERNAL_CONTEXT_MARKER` from `services/InternalContext.js`.
- INVARIANT: internal context must NEVER be transmitted to an external service.
  Before M4-1 it was appended with a bare `\n\n`, and
  `SearchEngine.extractCoreQuery` returns the query VERBATIM when it contains
  `:` (the block header ends with `):`), so the private block rode the literal
  search query to every provider.
- Egress choke points strip/split at their boundary: `SearchEngine.extractCoreQuery`
  (single search-egress point — strips before derivation),
  `SearchAgent.runSearchTeam` (splits; block reaches the SYNTHESIS prompt only,
  via `opts.internalContext`), `ComputerUseAgent.executeTask`,
  `NewsAgent.runNewsTeam` (feed URLs), `DataAgent.runDataAgent` (URL scan).
- `services/InternalContext.js` is deliberately dependency-free (no import of
  BrainRecall) so egress modules can import it without the wiring bootstrap.
- Test seam: `aggregateSearch` accepts `opts.__providerSearch` (mirrors
  `opts.__providers`) to assert the exact egress string with zero network.
- Regression suite: `tests/agi/test-internal-context-boundary.js` (wired into
  `jexi.verify.test` and the npm test chain).
- KNOWN, NOT FIXED: the director's task-graph framing ("Current task: TASK-001
  — … (completed)") also rides the search query. No private data; relevance only.

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
- **Phase 3B — remote fallback policy** (`server/src/services/NetworkPolicy.js`):
  keyless ⇒ "configured" ≠ local. `kilo` and `pollinations` are keyless AND
  REMOTE; the Phase 3A audit proved a local-lane failure slid a Director turn
  to `api.kilo.ai` (×3) / `gen.pollinations.ai` (×2). Locality is now decided
  by ENDPOINT, never by the absence of a key.
  - `JEXI_NETWORK_POLICY=allow-remote` (DEFAULT — unchanged) | `local-only`
    (hermetic: only loopback endpoints may be dialed; a local failure fails
    honestly, it never widens to a remote rung).
  - Per-call `opts.networkPolicy` may only TIGHTEN. `beginProviderAttempt()` is
    the single choke point before every dial (audit log + `__setProviderAttemptHook`
    guard seam). Enforced in `configuredProviders()`, `runtimeChain()`,
    `RealAdapters` altLanes, LLMClient `netGate` (stream / walk / tool /
    plain-text fallback) AND `testProvider()` (the live per-provider probe —
    previously an ungated remote dial). `filterProvidersByPolicy()` classifies
    each entry by its REAL provider id (`providerKeyOf()`), so `runtimeChain()`'s
    `{key, model}` lanes are filtered correctly instead of being stringified to
    `unknown` and dropped.
  - `providerHealthSnapshot()` rows now carry `local` + `allowed` alongside
    `configured`; `providerNetworkSummary()` reports the active policy.

## Testing

### Hermetic aggregate runner (M8)

`npm test` in `server/` is now `node tests/setup/run-suites.mjs`, which runs
`tests/setup/suites.json` — the exact ordered 204-suite list the old
`package.json` `test` chain contained (verified 1:1: same order, same
multiset, duplicates preserved). Add a suite by appending to `suites.json`.

`tests/setup/hermetic-preload.mjs` is preloaded into every child via an
ABSOLUTE `--import` in `NODE_OPTIONS` (a relative path breaks grandchildren
with a different cwd). It:
- sets `JEXI_TEST_HARNESS=1` (covers plain-script suites, which have no
  `NODE_TEST_CONTEXT`);
- refuses every non-loopback dial at the transport — `globalThis.fetch`,
  `node-fetch` (via `http.request`), and the default-object
  `node:http(s).request/get` — using `isLoopbackUrl()` from
  `src/services/NetworkPolicy.js`. Loopback keeps working. Refusals are
  recorded and printed on exit, never silent.
- Does NOT change `JEXI_NETWORK_POLICY` (leaving the product default intact
  keeps provider-classification suites honest); the guard blocks the transport
  instead. Opt out with `JEXI_TEST_ALLOW_EGRESS=1`.
- Caveat: ESM *named* imports of `node:http`/`node:https` are read-only
  bindings and cannot be patched. No `src` module uses that form, so coverage
  is complete; use the default object / CJS form in new code.

The runner gives each suite a wall-clock timeout and SIGKILLs its process
group on expiry, so a leaked language-server child can never hang the run.

Suites that genuinely need the network (Commons image search, DSH tool-web
contracts, hermes demo (c), the live weather MCP round-trip) guard their live
assertions with a `HEAD` preflight and print `⏭️ SKIPPED` under the harness
instead of failing on an environment property. This matters for the MCP case:
`@dangahagan/weather-mcp` boots via `npx`, and the spawned child inherits the
preload, so a blocked registry lookup inside that child is a hang, not an
error — the preflight must run in the parent and skip the spawn entirely.

`MissionRunner.create` skips its fire-and-forget `lspManager().startMission`
when `JEXI_TEST_HARNESS` / `NODE_TEST_CONTEXT` is set (opt back in with
`JEXI_LSP_INDEX_IN_TESTS=1`). The spawn leaked `tsserver` and hung
`node --test` on the stdio pipe; the index is a cold-start convenience, not
mission semantics, so the gate changes nothing a test asserts.

`tests/agi/test-hermetic-test-environment.js` pins all of the above.

- `tests/agi/test-network-policy.js` — Phase 3B remote-fallback policy (20
  tests). Installs a `globalThis.fetch` EGRESS GUARD that throws on any
  non-loopback dial, so a regression that leaks a remote request is a loud
  failure, not silent egress. Uses loopback fixtures only (`http.createServer`
  on `127.0.0.1:0`; every fixture is `close()`d or the process hangs). Covers
  the F1 lane-object filter (`{key, model}` classified by key), the F2 ungated
  `testProvider()` probe, and the F3 local-fallback exposure control.
  Mutation-verified: reverting any guard makes suites fail.
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

- Six-state model (Phase 2A): `exists` → `registered` → `permitted` →
  `reachable` → `executable` → `succeeded`.
  - `registered` = a tool exists in the catalog and resolves.
  - `permitted` = the ACTIVE profile's tier allows it.
  - `reachable` = registered AND has an engine AND permitted (the OLD `available`).
  - `executable` = `reachable` AND the runtime ring guard (`makeRiskGuard`) allows
    it — the ring and the `sideEffects` acknowledgement.
  - `succeeded` = a real, non-refused success in the outcome ledger.
  - `available` is a DEPRECATED alias for `executable`. It used to ignore the
    ring guard, so a `runtimeRing: 2` tool (term_execute, git_status…) reported
    `available: true` while the executor refused it at the `container` ring. It
    now equals `executable`, so that lie cannot recur. Prefer the explicit
    fields; `blockedBy` names the gate (`runtime_ring` vs `permission_denied`).
  - **`available + succeeded === executable` is CONDITIONAL (Phase 2B).** It
    holds only while no capability is succeeded-but-currently-blocked. Success
    is historical evidence and is never erased by the current gate, so a
    capability that succeeded earlier (e.g. at the host ring) stays `state:
    succeeded` while `executable: false`. The exact relation is
    `available + succeeded - executable === (succeeded && !executable)`.
    `capabilitySummary().ringBlocked` counts
    `registered && !executable && blockedBy.includes('runtime_ring')` — the
    `!executable` term keeps an executable MCP-backed capability (a ring-2
    native provider plus an out-of-ring MCP provider) out of the blocked count.
  - **The prompt states the gate that actually blocked a capability.** A
    `runtime_ring` block always reports the execution ring and never the
    permission profile, even for an id with a stale `UNMET_HINT` entry
    (`terminal`), because the profile may permit it while the ring refuses it.
  Never assert a state — derive it. `describeCapability(id, { profile, sandboxRing })`
  returns the reason. `resolveSandboxRing()` mirrors the executor's
  `ringForBackend()` so the report and the executor cannot drift.
- `selection.js` offers tools on `reachable`, NOT `executable`: tool offering is
  unchanged from before (a ring-blocked tool is still offered and refused
  honestly at execute time, never silently withheld). Only the reported
  `available`/`executable` flag became ring-aware.
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

## Prompt assembly budget (`services/PromptAssembly.js` + `ContextEngine.js`)

- `assemblePrompt()` builds ordered sections, then `compileSections()` enforces
  the total budget. Sections marked `keep: true` (persona, instructions,
  tool-SDK, policy, capabilities, and the conversation **thread**) are dropped
  LAST, never first.
- The default budget is **32000 chars / 8000 tokens**. The mandatory floor —
  the persona (`JEXI_SYSTEM_PROMPT`, ~23k) plus the generated capability block
  (~2k) plus a bounded conversation tail (≤4k) — is ~29k, so the old 24000 cap
  could not hold it. Raising the cap is not a fix on its own: the budget is a
  **hard** limit (a keep-only overflow is shaved, not exceeded).
- The conversation tail is required continuity context. It is bounded at 4000
  chars and pushed `keep: true`; dropping it silently makes a mid-conversation
  turn re-answer from scratch. `server/test-memory-direct-path.js:94` guards it.
- Regression origin: `9bf359d` added the capability block as a `keep` section
  on top of the already-grown persona, pushing the floor above 24k. The drop
  loop then shed every non-keep section (thread, tmux, time) and returned an
  over-budget prompt with the thread gone.

## Gotchas

- **A local test run can hang on an untracked artifact, not the code.**
  `server/jexi-workspace/` (gitignored) holds a real project tree; when it
  contains a `.ts` file, `AgentLoop`'s LSP wiring spawns
  `typescript-language-server --stdio` and leaks the child + its sockets, so a
  suite that never closes them never exits (`node --test` passes but the
  process hangs, e.g. `test-observer-chat-events.js`). CI is unaffected — the
  tree is not checked out there. Reproduce on a clean `git worktree` before
  blaming the change: same commit passes in a fresh worktree and hangs here.
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
- **Two known registry gaps, out of scope for Phase 2B (follow-up).** (1) MCP
  providers are not profile-gated: `docs_lookup`, `papers` and `encyclopedia`
  report `executable: true` even under `readonly`, because the registry applies
  `RISK_TO_TIER` to NATIVE tools only (MCP servers carry their own grants). (2)
  `executable` reflects the ring plus the `sideEffects` DECLARATION, not a
  runtime `confirm` callback; `wiring/phase31-registries.js` builds its executor
  with no `confirm`, so a future caller that passes one could see
  `executable: true` on a tool the user then declines. Neither weakens a control
  today — close them if MCP gating or interactive confirmation becomes a
  requirement.
- **Intent classification is substring matching — bound every short token.**
  Phase 2A: the `legal_task` rule matched the bare substring `lease`, so
  "the latest Node.js re·lease" routed to the legal team and lost its web tool;
  `DomainRegistry` had short bare alternatives (`ode` in applied-mathematics,
  `wes` in genetics-genomics) that matched inside "Node" and "newest". Phase 2B
  closed the last gap: seven digit-bearing tokens were still unbounded — `3dof`,
  `4g`, `6dof`, `cas9`, `gsm8k`, `m2m`, `ss7` — so "a 4GB file" matched
  telecommunications through `4g`. All depth-0 bare tokens of 2–5 chars in
  `DomainRegistry` are now delimited: the Phase 2B set with a literal `\b`, and
  ~198 older ones (e.g. `dsp`, `pon`, `mimo`) with a raw 0x08 byte the original
  author used as a boundary. Both are inert against ordinary prose (the 0x08
  form only matches a literal backspace, so those acronyms do not match plain
  input — a latent defect, not a false positive). Use `\b`, do not add more
  0x08 bytes; a scan for undelimited depth-0 alternatives returns zero.
  Regression: `tests/agi/test-intent-classification.js` (both directions,
  including "a 4GB file" must not match and genuine 4G/SS7/M2M/Cas9 still do).

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
- Non-hermetic suites: scrubbing `*_API_KEY` is NOT enough to force the
  "no provider answered" path. The keyless remote legs (kilo, pollinations) are
  always "configured", so on a runner WITH egress the model call succeeds and a
  test that proves an honest no-model outcome sees a fake success (e.g.
  `test-judge-gates` gate PASS instead of UNKNOWN; `test-intent-lean` dead
  provider answered; `test-arena-astra` ladder returned `remote`;
  `test-request-economy` no longer rejected). Pin `JEXI_NETWORK_POLICY=local-only`
  at the top of such a suite — loopback mocks keep working.
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

## M5 — privacy closure + capability proof (2026-10-27)

- TASK-FRAMING EGRESS (fixed): `server/index.js:2559` composed the task-state
  block (`decision.contextBlock` = `taskContextBlock`, full of `:`) AHEAD of the
  user's follow-up with a bare `\n\n`. On continue/switch research turns that
  string reached `runSearchTeam`, and `SearchEngine.extractCoreQuery` returns
  the string VERBATIM when it contains `:` — so task id/objective/steps/files
  egressed to third-party engines. Now composed via
  `withInternalContext(effectiveQuery, ...)` (question first), so every egress
  choke point (`extractCoreQuery`, `SearchAgent` split, news/data/browser
  strips) recovers the exact question. Regression: `tests/agi/test-internal-
  context-boundary.js` T-i / T-j. `test-audit-b48.js` (which pinned the old
  literal) is RETIRED (SKIP, rc=0).
- PROBE-DISCOVERED DEFECTS (open in M5, ALL THREE CLOSED IN M6 — see the M6
  section below):
  1. `AgenticDecision.runFileRead` (`file_read` lane) reads ANY absolute path
     with no confinement — `resolveWithin` (`src/tools/security/path-
     confinement.js`) is bypassed, and no `tool_use` event is emitted. Verified
     live: read `/etc/passwd` and an out-of-workspace canary verbatim.
  2. Final-response consistency: the Director/Forge lane executed `node
     fail.js` (tool_use shows `exit 3`, twice) yet the delivered summary said
     "It wasn't executed this turn". Evidence and prose disagree.
  3. `Vera` verification verdict: `exact.txt` was 6 bytes (`HELLO\n`) against a
     required 5, and the log itself noted "wrote exact.txt (6 bytes)", yet
     verification returned `pass (0.75)`. The byte-level criterion was not
     enforced.
- EGRESS NOTE: the `file_read` / `web_search` agentic runners are REAL (`fs`
  / `aggregateSearch`) but emit no `tool_use` event — absence of a tool event
  is NOT evidence a tool did not run. Read the runner source, not the event
  stream, when judging.

## M6 — execution-integrity closure (2026-10-27)

Three confirmed execution defects, fixed in priority order and proven by
`tests/agi/test-m6-execution-integrity.js` (27 tests, deterministic, headless,
zero network, zero real model calls).

- D1 FILESYSTEM CONFINEMENT. `AgenticDecision.runFileRead` resolved any path
  with `path.resolve(p)` — absolute paths, `../` traversal and symlinks out of
  the workspace all returned real bytes. It now routes EVERY caller path
  through the one authority (`resolveWithin(..., { followSymlinks: true })`);
  a refusal returns NO contents, only the reason. The coding-lane editor
  (`StrReplaceEditor.abs`) had the same symlink hole (a bare `startsWith` after
  `path.resolve`) and now also uses `resolveWithin`. `tool_use` rows are emitted
  truthfully (`status: 'error'` on denial, `'success'` on a real read) via the
  new `emitAgenticToolUse`; `sendEvent` is threaded `agenticTurn → executePlan →
  runner` and `AgentLoop → executeCapabilityKeyless` so sub-agent reads emit too.
  `deriveArgs('file_read')` now extracts full path tokens (`sub/dir/f.txt`), not
  just absolute ones.
- D2 EXECUTION-RESULT INTEGRITY. `Director.composeReport` told the report model
  "Real commands executed this task: NONE" whenever it saw no
  `COMMAND_COMPLETED`/`TEST_COMPLETED` — ignoring `COMMAND_FAILED`. A command
  that ran and exited 3 was reported as "not executed this turn". New
  `src/services/director/ExecutionRecord.js` derives ONE authoritative record
  from the event log (a failed run is still a run; blocked ≠ not attempted;
  started-without-terminal = still running; timed-out ≠ never ran). It feeds the
  report prompt, the fallback answer, `task.result.execution`, and a
  deterministic backstop (`appendExecutionNoteIfContradicted`) that appends the
  record when a model still claims nothing ran.
- D3 VERIFICATION CORRECTNESS. A criterion demanding a file be "exactly 5
  bytes" passed against a record showing 6 bytes, because the verdict came from
  the rubric model alone. `Verifier` now has Gate 1.8 (`evidenceContradictions`):
  machine-checkable exact values are decided from the task's own record
  (`FILE_CREATED`/`FILE_UPDATED` `data.bytes`); a contradiction fails
  deterministically and the rubric cannot override it (ANDed with the gates).
  The rubric prompt's execution evidence now carries recorded byte counts.
- VERIFIED: 42/42 `tests/agi/*` suites, the `jexi.verify.test` set (99 tests),
  and the Director suites (b208 96, b210 64, b213 28, f5 37) all pass. The
  `tests/tickets/*` failures (sandbox/testing/verify/profiles/pytest) are
  PRE-EXISTING environment failures — identical counts at the `ca3b91e`
  baseline.
