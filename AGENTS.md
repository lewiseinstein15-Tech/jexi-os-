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

## Subagent isolation boundary (M9)

- An isolated child (`context: fork`) keeps its execution transcript private.
  `services/SubagentIsolation.js` is the SINGLE enforcement point every
  parent-visible path funnels through: the result object, the summary, the
  artifacts, the error string, and the streamed events.
- RULE: model-generated prose is a COSMETIC layer, never a security control.
  A summarizer's output is accepted only after deterministic gates, and the
  hard cap (`MAX_PARENT_SUMMARY_CHARS = 350`) is applied LAST — so the boundary
  holds with no provider, a hostile provider, or a paraphrasing provider.
- artifacts come ONLY from the child's explicit `report` tool
  (`services/SubagentReport.js`, opened per isolated run in
  `SubagentRuntime.runIsolatedSubagent`); transcript lines are NEVER lifted
  (the pre-M9 `keyArtifacts` shape heuristic is gone).
- events: `sanitizeChildEvent` allowlists `subagent.start|plan|progress` and
  drops `stream`, `think`, `agent.done`, `agent.log`, `log`, `tool.result|call`
  (default-deny). Pre-M9 the child's raw `sendEvent` was forwarded, so
  `agent.done` carried the whole transcript to the parent.
- status is validated (unknown → FAIL, never a silent pass); errors are bounded
  and single-line. Residual limitation (documented, not hidden): a marker the
  child placed near the HEAD of its report can appear inside the bounded
  summary — the boundary guarantees boundedness and the absence of the raw
  transcript, not semantic secrecy of every token the child emitted.
- Regression suite: `tests/agi/test-subagent-isolation-boundary.js` (16 tests,
  hermetic via a loopback provider; registered in `tests/setup/suites.json`).
  All three regressions fail against the pre-M9 implementation.

## Durable chat recovery (M10)

- The chat session store (`services/SessionStore.js`) used to be IN-MEMORY only,
  so a process restart erased a task parked at an approval gate, the resume
  offer and the last completed result — the paused work and its evidence were
  silently lost. It is now backed by `services/DurableStore.js` (atomic JSON
  under `DATA_DIR/sessions/`, added to `RedisMirror.MIRRORED_DIRS`), keyed per
  session so sessions stay isolated.
- `services/ChatRecovery.js` is the SINGLE, pure classification authority. The
  state machine: `not_started | running | interrupted | awaiting_approval |
  awaiting_verification | completed | failed | cancelled`. Classification keys
  off the record's `epoch` (the boot identity that wrote it): a record whose
  epoch is not THIS process is `interrupted`.
- HONESTY INVARIANTS (each has a test):
  - a parked approval is RESTORED but NEVER auto-approved — `resolved` is never
    set by recovery; only a real user "yes" resolves it;
  - an `interrupted` run is reported `uncertain` (outcome UNKNOWN) and is NEVER
    presented as done — `resumeSafety()` returns `uncertain` so a possibly
    side-effecting step is not blindly repeated, and the resume surfaces the
    uncertainty in the final summary;
  - a `failed`/`cancelled` run is terminal and never recovered as successful;
  - where exactly-once is guaranteed, completed steps are never re-run; where it
    is impossible, the uncertainty is stated, not hidden.
- CONCURRENCY: `claimRun`/`releaseRun` guarantee a single worker per parked run
  within a process (a claim held by another worker is refused), so two "yes"
  turns cannot double-execute the paused node.
- STALE APPROVALS: the pending offer and the parked run must describe the same
  task, and `approvalMatches` rejects an approval naming a different
  node/action — a stale approval never authorizes a different action.
- CORRUPTION: `DurableStore` writes are atomic (temp + rename) with a `.bak`
  fallback; a corrupt primary loads as absent (never throws), recovers from the
  `.bak` when possible, and `recoverSessionsOnBoot()` flags the slot honestly.
- Boot recovery is called in `index.js` (never blocks boot; logs what it found).
- Regression suite: `tests/agi/test-durable-chat-recovery.js` (16 tests,
  deterministic, hermetic — temp storage, injected fake actions with execution
  counters, ZERO network, ZERO model calls; includes a real cross-process
  restart via a spawned child). Registered in `tests/setup/suites.json`.
- WHY NOT the SQLite `src/workgraph` engine as the chat engine: it persists ONE
  graph snapshot per file and models mission nodes/leases, not the chat
  `RunState` (intermediateResults / confirmationPayload / resumeNode), and it is
  not wired into the chat path. Reusing its storage PATTERN (atomic JSON under
  DATA_DIR, Redis-mirrored) is the smallest defensible change.

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

## M15 — reliable tool execution + evidence-grounded completion (2026-11-01)

Two reliability weaknesses M14 found, plus the test-isolation bug they exposed.

- **Fix 1 — the tool was offered but could never run.** `term_execute`
  declared `runtimeRing: 2` while `SessionSandbox` enforces ring 1, so the
  RiskGuard refused it on every coding turn under a container sandbox: the
  model saw it in its menu and every call came back "requires runtime ring 2,
  sandbox allows container (1)". `term_execute` runs INSIDE `SessionSandbox`
  (like `pytest_run`), so the sandbox — not the ring number — is the
  containment boundary. Now ring 1.
  - Second, real half of the same failure: the container ran `--user 1000:1000`
    while the host workspace is owned by uid 10001, so a `fs_write` succeeded
    and the follow-up `python3 hello.py` failed "Permission denied". The
    container user is now the HOST uid:gid (`SessionSandbox.sandboxUser()`,
    `JEXI_SANDBOX_UID` overrides). Verified: write-then-run works and files
    created in the container land on the host owned by the host user.
  - `detectSandboxBackends` claimed `namespaces:true` whenever the `unshare`
    BINARY existed; in a nested container the kernel refuses the user
    namespace, so the fallback chain selected a backend that then failed every
    command. It now probes `unshare` for real and falls through to the honest
    `cwd` backend, with `namespacesReason`.
- **Fix 2 — success without evidence.** `CodingLoop.successGate` graded a turn
  with no mutating call `not_applicable/canClaimSuccess:true`, so "read a file,
  call it done" — or a turn whose every tool call failed — was a reported
  success. Now: an unresolved failed call (failed and never retried
  successfully) is `unverified/false`; a coding-intent turn
  (`coding.evidenceRequired`) that produced NO successful tool call is
  `unverified/false`. A plain answer with no tool use stays
  `not_applicable/true` (asking is not completing).
- **Fix 2 (tool selection) — prose tool-call recovery.**
  `services/agent/ToolCallRecovery.js`. Small models write the call they mean
  as text (`{"name":"fs_write","parameters":{…}}`) instead of a native
  `tool_calls` array; the round then looked like a direct answer and the task
  ended with zero tool calls. `LLMClient.runToolLoopForProvider` recovers such
  a call ONLY when the round produced no native calls, ONLY for a tool already
  in the offered menu, and executes it through the SAME gated
  `executeToolCalls` path. Observable via `opts.onRecoveredToolCalls`.
- **Honest disclosure.** `buildNativeSchemas` appends a `[NOT RUNNABLE …]` note
  to a tool whose declared ring exceeds the enforced ring, via
  `ToolRuntime.toolRunnable` (same ring comparison as the guard). The tool is
  still OFFERED (M12) and still callable — the note only removes the surprise
  of a guaranteed refusal.
- **Test isolation (settings.json).** `SettingsManager` pinned
  `SETTINGS_FILE = cwd/settings.json` at import time, so any test booting the
  backend with `cwd=server/` read/wrote the developer's REAL config: a
  configured provider overrode the mock (test-tui-engine failed), and a test
  could clobber the saved config. `settingsFile()` now honours
  `JEXI_SETTINGS_FILE` (resolved per call), absent which the path is unchanged.
  `test-tui-engine.js` sets it to a temp file.
- Tests: `tests/agi/test-m15-reliability.js` (26) — prose recovery incl. a real
  loopback-provider round-trip that proves the recovered call is EXECUTED; the
  evidence gate; honest disclosure; a REAL docker write-then-run; the ring
  fix; settings isolation both directions. `test-capability-state.js` updated
  to use `git` (still ring-2) as the ring-blocked example.
- **Gotcha — nested `node --test`.** A child `node --test` under a parent
  `node --test` exits 0 immediately ("recursively … skipping"), so a failing
  child looks green. Use a plain assert script as the child command under the
  harness; real `node --test` only outside it.
- **Gotcha — `sessionSandbox` takes an OBJECT** (`{root, backend}`), not a
  path. `sessionSandbox('/tmp/x')` silently falls back to `process.cwd()` and
  the run touches the repo, not the intended workspace.

## M12 — intelligent tool selection / progressive disclosure (2026-10-31)

- **Architecture.** `services/agent/ToolBundles.js` (bundle vocabulary as data)
  + `services/agent/ToolDisclosure.js` (initial-menu selection + on-demand
  expansion). `ToolSetBuilder.buildOfferedTools` runs a final disclosure step
  that REBUILDS the initial menu from the disclosure slugs resolved through the
  live registry (not by filtering earlier steps, which could starve the turn).
  `AgentLoop` adds a `request_tools` meta-tool and handles it in the tool-call
  loop by pushing newly resolved schemas into the LIVE menu; `LLMClient`
  re-reads `opts.getTools()` each provider round so a disclosure in round N is
  callable in round N+1. Permission/RiskGuard/approval are untouched — a
  disclosed tool is still gated at execute time (there is a test for this).
- **Root causes fixed (all three were real, all three were silent):**
  1. `isCodingIntent` matched `code`/`coding`/`fix`/… but the Planner emits
     `code_task`/`code_fix`, so the coding cap never engaged.
  2. `resolveToolDef` returned a bare `{slug,name,permission}` stub for DOMAIN
     tools, dropping `parameters` — every domain tool (`fs_write`, `fs_edit`,
     `term_execute`) reached the model with an EMPTY argument schema, so the
     model could not form a valid call. Fixed by publishing `getDomainTool` on
     the domain probe and passing a native JSON-Schema `parameters` straight
     through `buildNativeSchemas`. (This is the "offering half" of JEXI-017; M11
     saw it but it was masked by the 41-tool menu.)
  3. An intent with NO bundle mapping fell back to the FULL catalogue, so the
     narrowing was a coin flip on the LLM intent label — a coding task
     classified `observability` got 24 tools. Unmapped intents now get
     `DEFAULT_BUNDLES` (`filesystem`+`terminal`); an explicit `[]` mapping
     (`self_check`) still means "no disclosure".
- New narrowed coding menu: `fs_read, fs_write, fs_edit, term_execute,
  pytest_run, capability_check, ask_user_question, request_tools`.
- Tests: `tests/agi/test-tool-disclosure.js` (14 pass) covers the vocabulary
  mismatch, the unmapped-intent floor, the domain-schema pass-through, honest
  expansion, and the execute-time gate.
- **Harness gotcha (cost me a false result).** `run.mjs` reports
  `model: provider-ladder (keyless floor: kilo/pollinations)` in the manifest
  unless `BENCH_MODEL` is set — and the run silently uses the NETWORK keyless
  ladder unless `MODEL_PROVIDER=ollama OLLAMA_HOST=… MODEL_NAME=…` are exported.
  A run that looks like llama3.2:3b can be a remote model. ALWAYS check
  `manifest.model` before comparing to an M11 number.
- **Env gotcha.** A resumed sandbox has NO ollama. Install the full tarball
  (`ollama-linux-amd64.tar.zst`) — copying only `bin/ollama` leaves
  `lib/ollama/llama-server` missing and every generation 500s in ~3s with
  `llama-server binary not found`. That fast-500 is the signature of a dead
  provider, not an agent regression.

## M11 — HumanEval-live benchmark (2026-10-30)

- Harness: `benchmarks/humaneval-live/` (`run.mjs`, `report.mjs`,
  `probe-toolmenu.mjs`, `lib/{tasks,agent,schema-patch}.mjs`). Measurement only;
  no JEXI source changed. Result + root cause: `benchmarks/humaneval-live/RESULTS.md`.
- **First externally grounded result** (llama3.2:3b, local keyless ollama,
  `--profile full`, commit `d10d72cf`): gold **10/10**, jexi as-shipped **0/15**,
  jexi schema-repaired **0/15**. Dataset sha256 `094a17ac…c157`, 164 tasks.
- **The zero is a tool-adoption failure, not bad Python.** 14/15 tasks make
  ZERO tool calls — the model writes the answer as prose. Measured by replaying
  the exact request JEXI sends, varying one input at a time:
  - 41 tools → 0/4 tool-call (both JEXI and short prompts)
  - 3 tools → 3/4 with a short prompt, 1/4 with the JEXI prompt
  So the **offered tool-menu size is the dominant factor**, and the ~25 KB JEXI
  system prompt suppresses tool use further at 3 tools. `qwen3:4b` also gives 0
  tool calls at 41/15/6 tools — a small-model capacity limit.
- Streaming is NOT the cause: `stream:true` and `stream:false` both fail. The
  schema-repair leg changes schema *contents*, not the tool *count*, so it does
  not move the score. Permission gate (`code-write`/`code-run` are `risky`) is
  real but not binding — under `full`, which permits them, the model still does
  not call them.
- Harness gotchas: **run legs one at a time** — ollama serves one model on one
  CPU and concurrent runs inflate every wall-clock. `run.mjs` calls
  `process.exit(0)` after writing results because JEXI's runtime leaves
  health-check timers armed; `withTimeout` unrefs its timer for the same reason.
  `settings.json` under the harness dir is gitignored (root `.gitignore:14`).
- Highest-leverage follow-up (NOT done — M11 is measurement only): narrow the
  offered tool menu for a coding turn. That is an agent-architecture change.

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

## M13 — Native TUI (`interfaces/cli`)

- `interfaces/cli` is a **zero-dependency** Node client to the local backend.
  The TUI drives the REAL engine over NDJSON `/api/chat`; nothing is canned.
- Module map: `commands.js` (pure parser+registry), `redact.js` (secret
  scrub at the transcript boundary), `app.js` (control flow), `rows.js`
  (wire→row), `transcript.js` (pure reducer), `render.js` (pure frame).
- **KEY PUMP** (`app.js`): stdin is read continuously into an inbox and a
  chat turn runs DETACHED from it, so keys are processed *during* a streaming
  turn. This is what makes mid-turn Ctrl+C real. `runTui` awaits any
  in-flight turn before teardown. Do NOT go back to awaiting the whole turn
  inside the key loop — that silently breaks cancellation.
- Approval flow: the TUI only *asks*; the engine still decides. `/approve`
  and `/deny` submit the engine's OWN `yes`/`no` confirmation as a normal
  turn (`CONFIRM_RE`/`DECLINE_RE` in `server/src/services/Orchestrator.js`).

### Testing the TUI
- `interfaces/cli/test-tui.js` — offline unit checks (60), no backend.
- `server/tests/agi/test-tui-engine.js` — integration: boots the REAL backend
  as a child with `MODEL_PROVIDER=ollama` + `OLLAMA_HOST=http://127.0.0.1:<port>`
  pointing at a mock OpenAI-compatible server, then drives turns through the
  TUI's own `JexiApi` + transcript. Hermetic (loopback only). Registered in
  `server/tests/setup/suites.json`.
- `interfaces/cli/bench-tui.mjs` — runs benchmark tasks THROUGH `runTui`
  headless with a scripted stdin (never a private API path). Feed tasks as
  JSONL `{id, prompt, expect?}`.
- GOTCHA — a `Promise.race` timeout arm leaves a live timer that holds the
  event loop open (process hangs after the work is done). Always `clearTimeout`
  in a `finally`.
- GOTCHA — a fast conversational turn answers in the terminal event's
  `summary` (a `turn-end-ok` row's `text`), NOT as streamed `text` rows. Read
  both when extracting an answer.
- GOTCHA — for a headless/scripted run, end stdin with EOF (not Ctrl+C) when
  you want the COMPLETE answer: `runTui` drains the in-flight turn on exit,
  whereas Ctrl+C aborts it.
- GOTCHA — the key pump keeps stdin referenced; after `/exit` the TUI restored
  the alt screen but the Node process never exited (stdin held the event loop
  open). `cleanup()` in `lib/tui/app.js` now calls `input.unref?.()` after
  `input.pause?.()`. Regression existed from M13 (`c93e822`); pre-M13 `cc95a45`
  exited cleanly. Headless (`stdin` a pipe) never showed it — TTY-only.
- GOTCHA — `server/settings.json` (untracked, written by a real session) used to
  make `server/tests/agi/test-tui-engine.js` fail: the child backend booted with
  `cwd=server`, `SettingsManager` read that file, a configured `unified` provider
  answered the turn, and the mock provider recorded 0 calls. FIXED in M15 — the
  suite now pins `JEXI_SETTINGS_FILE` to a temp path (and `SettingsManager`
  honours it), so it is hermetic in both directions and no longer depends on the
  developer's config being absent.

## M16 — benchmark qualification (read before trusting any JEXI pass-rate)

- VERDICT: NOT READY for the head-to-head. See `docs/M16-READINESS.md`.
- D1 — a green `test_run` CANNOT make a turn `verified`. `executeTool` returns
  `result` as a formatted STRING (`ToolRuntime.js:1969`,
  `finalText = formatResult(result)`), but the M15 gate reads
  `r.result.status` (`AgentLoop.js:388/393`), so those branches are dead code
  and `noteTestResult`/`readTestVerdict` never see a real verdict. The other
  route (`verifyAfterEdit`) is also unreachable in a bare sandbox: `lint` fails
  with "0 diagnostics" (eslint exits 2, no `src/`), `unit`/`build` error "no
  command configured". A coding turn is unverifiable by construction there.
  `test-m15-reliability.js` is 26/26 green because it INJECTS the seam and
  never wires a real `executeTool` result into the gate — that is the test gap.
- D2 — the HumanEval harness is NOT reproducible. Same dataset/model/prompt
  gave 8/15, 2/15, 1/15, 9/15, 0/6. b1-vs-b2 disagreement is purely the 150 s
  timeout cap (the disagreeing rows are exactly the `durationMs >= 150000`
  rows; `RESULTS.md` already requires `--timeout 300`). At 300 s a clean run
  passed tasks 0-8 then failed 9-14 with ZERO tool calls and no `agentError` —
  intermittent and run-dependent, not task difficulty (a fresh slice of 9-14
  also scored 0/6) and not the model server (a direct `api/generate` probe
  returned correct code). Suspect: cross-task state or a silent keyless-ladder
  slide in `providers/runtime/LLMClient.js`. Unconfirmed — next mission.
- D3 — `run.mjs` scores a TIMED-OUT task `pass` if the file it left happens to
  grade (bench4 HumanEval/3: `pass=True` with
  `agentError="agent loop timed out after 300000ms"`). Reconcile before any
  comparison.
- GOTCHA — never run another CPU-heavy process while a benchmark runs. A
  concurrent scenario harness starved the model and produced a bogus 1/15
  (8 rows with zero tool calls). One bench process at a time.
- GOTCHA — the model's own answer can quote the false lint failure ("The ESLint
  verification error is unrelated to the Python code"), i.e. the D1 false-fail
  is visible to the agent under test.
- HARNESS — `benchmarks/humaneval-live/completion-integrity/` (scripted SSE
  provider + 7 completion-integrity scenarios + `run-all.mjs`); one scenario
  per process because `runTaskWithJexi` mutates `process.env.WORKSPACE_DIR` and
  `AgentLoop` keeps one global turn. `benchmarks/humaneval-live/slice.mjs` runs
  an arbitrary `[start,end)` task slice in a fresh process.

## M17 — verification integrity + benchmark determinism (D1/D2/D3 FIXED)

- VERDICT: all three M16 blocking defects fixed. See `docs/M17-FINDINGS.md`.
- D1 — the completion gate now reads TYPED metadata, not a formatted string.
  `server/src/services/agent/exec-meta.js` derives `meta` (kind/status/
  timedOut/exitCode/tests/passed/failed) from the engine's RAW result;
  `attachExecMeta` is called on EVERY `executeTool` return path in
  `ToolRuntime.js` (blocked/declined/paused/denied/unknown/timeout/fail/ok).
  `result` stays the string the model sees; `meta` is the machine truth.
  `AgentLoop.js` uses `isPassingTestMeta(r.meta)`; `CodingLoop.noteTestResult`
  uses `readVerdict(name, result, meta)` (typed first, legacy fallback).
  Honesty: pass-with-0-tests => error; exitCode -1 with no output => timeout;
  blocked/denied/not_run/error are never passes. `LintVerifier` now reports a
  runner error (nonzero exit, zero diagnostics, zero messages) as `error`, not
  a false `fail`.
- D2 — deterministic provider via `JEXI_PROVIDER_LOCK`. `providerOrder(prefer)`
  in `providers/runtime/ProviderRouter.js` reduces the ladder to exactly the
  locked provider (survives intent/lane preference); unset keeps fallbacks.
  `providers/runtime/ProviderAttempts.js` (new) records every lane dial
  (`beginProviderAttempt`/`recordProviderAttempt`, bounded buffer,
  `providersThatServed()`, `resetProviderAttempts()`); `LLMClient.js` records
  on all three lanes (text/tools/plain-text-fallback). `run.mjs` manifest
  records `providerLock` + `ladderSlid`; rows record `providerAttempts`.
  Two identical locked runs: 0/15 each, `ladderSlid=0`, only `ollama` served,
  zero false passes. 0/15 is the TRUE capability of llama3.2:3b on CPU with
  the ladder locked (no silent substitution) — not a harness artifact.
- D3 — `benchmarks/humaneval-live/lib/score.mjs` (new) reconciles grader +
  agent outcome, shared by `run.mjs` and `slice.mjs`: RESOLVED only when the
  agent loop completed without error AND the grader ran AND the grader passed.
  M16's two false positives (HumanEval/13, HumanEval/3: `pass=true` + timeout)
  now score `pass:false` with `agentTimedOut:true`.
- GOTCHA (re-confirmed) — never run tests or any CPU-heavy process during a
  benchmark; a killed run can orphan a `llama-server` that keeps burning CPU
  (check `ps aux | grep llama-server` and kill it before the next run).
- Pre-existing, NOT caused by M17: `jexi-016-019-structure.test.js` fails 2/10
  at HEAD (AgentLoop line budget — HEAD is 616 lines vs budget 560; and
  ToolSetBuilder ordering). M17 grew AgentLoop by only 2 lines.

## M18 — failure attribution (docs/M18-FINDINGS.md)

- 0/15 on the locked `llama3.2:3b`/`ollama` run is dominated by a MODEL
  capability ceiling, not a plumbing defect. Categories: A=4 (fs_write called,
  `content` written with literal `\n` -> `SyntaxError`), B=10 (NO tool call;
  `solution.py` left as the materialised stub -> `check()` asserts), C=1
  (written correctly, wrong algorithm). 4 of these also hit the 300s timeout.
- R1 (dominant): `llama3.2:3b` emits a NATIVE tool call only ~1/3 of the time
  on JEXI's ~7.5k-token prompt, even at temp 0 and `tool_choice:'required'`;
  otherwise it writes the call as prose with a name (`code_write`) not in the
  offered menu, so `recoverToolCallsFromText` correctly refuses it. Same prompt
  served by `kilo-auto/free` scored **11/15** (6-9 native calls/task, 0
  timeouts) — see `results/humaneval-jexi-as-shipped-2026-11-02T13-45-25-239Z.json`
  (ladder slid because `JEXI_PROVIDER_LOCK` was unset).
- R2 (real, small defect): a recovered/prose `fs_write` call can carry literal
  `\n` in `content`; `fs_write` writes it verbatim -> `SyntaxError`.
  Escape-normalising `HumanEval/3`'s content grades PASS (raw grades FAIL).
  Smallest evidence-supported change = normalise `\n`/`\t` in write-tool
  content; bounded to ~1/15 on this slice.
- R3: Ollama's OpenAI `/v1/chat/completions` lane evaluates only **2050** prompt
  tokens regardless of `options.num_ctx`, top-level `num_ctx`, or the loaded
  context; native `/api/chat` honours `options.num_ctx` (7220). The user task
  message survives (a codeword in it is reproduced); the middle of the 25k
  system prompt is dropped. Real, but NOT the dominant cause (a bounded prompt
  still gave prose 2/3 probes).
- GOTCHA: probing the ollama `/v1` lane with the SHIPPED shape can run away for
  >30 min (the model never emits a call and keeps generating) — always pass
  `max_tokens` in probes and `kill` any orphan `llama-server` after.
- GOTCHA: run the unlocked contrast run only when a ladder slide is intended;
  otherwise set `JEXI_PROVIDER_LOCK` so the measurement stays honest.


## M19 — deterministic tool-calling reliability (docs/M19-FINDINGS.md)

- Two confirmed JEXI-side tool-payload defects, both fixed and bounded. NO
  benchmark-score tuning: the objective was reliable execution, and the
  headline (5-task slice, locked `ollama`, no ladder slide) is **before 0/5
  (2 timeouts) → after 1/5 (0 timeouts, 0 SyntaxErrors)** — a controlled A/B
  with the source fixes stashed for the "before" leg. Residual failures are
  `AssertionError` (parseable, executable, wrong algorithm) = model ceiling.
- D1 (alias gap, the M18/R1 dominant failure): the model emits a well-formed
  prose call named `code_write` / `code-run` — names JEXI ITSELF advertises in
  `ToolRegistry.js` — while the offered menu holds the domain implementations
  `fs_write` / `term_execute`. Recovery correctly refused the unoffered name,
  so the turn died with zero calls. The benchmark query even says "use the
  code-write tool". FIX: `ToolCallRecovery.js` `TOOL_ALIASES` +
  `resolveToolName(raw, offeredNames)` — an alias resolves ONLY when its TARGET
  is in the offered menu (an alias to an unoffered/invented name returns null,
  so recovery can NEVER expand the menu) — plus a `filename`→`path` key bridge
  applied only when `path` is absent. `resolveAlias` returns
  `{name, arguments, aliasedFrom}`; M15 F1 example name changed
  (`code_write`→`totally_made_up_tool`) because `code_write` is now deliberately
  bridged; the M15 invariant (invented names still refused) is preserved.
- D2 (write-payload double-escaping, M18/R2 EXTENDED):
  `services/agent/WritePayloadNormalizer.js` (new). M18 saw the PURE form
  (every newline literal `\n`, no real newline). M19 measured the MIXED form
  live: literal `\n` OUTNUMBER real newlines but ≥1 real newline is present
  (HumanEval/1: 7 literal vs 1 real). The old "no real newline at all" guard
  refused the mixed form, so it still wrote broken. FIX: dominance guard
  (`literal>=2 && literal>realNL` when any real newline exists) + the
  string-aware `decodeEscapedControls` scanner (quoted regions — `"…"`, `'…'`,
  `"""…"""` — preserved, so a regex/Windows path/JSON escape is never
  corrupted). Wired in `ToolRuntime.js` `executeToolInner`; emits
  `tool.payload_normalized`. Only whole-file tools (`fs_write`/`fs_append`).
- D3 (bounded malformed-call retry): `LLMClient.js` `generateWithToolsLoop`
  re-asks ONCE per turn (`malformedRetryUsed`, function-scope) when a round
  produced no calls but clearly attempted one (`looksLikeToolAttempt`); opt-out
  `opts.__noMalformedRetry`; output goes through the same native/recovery parse
  (no fabrication). `AgentLoop.js` surfaces it via an `agent.log` line.
- Invariants held: no gate bypass (every call still runs the real gated
  `ToolRuntime`), no fabricated calls, recovery cannot expand the offered menu.
  Suites: **210/210 pass** (was 209; +1 M19 suite, 28 tests). M15: 27 pass / 1
  skip. `ToolCallRecovery.js` is the single recovery entry point for both the
  native parse and the malformed retry.
- GOTCHA: the benchmark runner needs `MODEL_NAME` (or `OLLAMA_MODEL`) set to the
  pulled tag; without it the loop defaults to a model that is not pulled, ollama
  404s, and the locked ladder has no fallback -> every task fails in ~2.4s with
  `tools=0` and NO `agentError` (a silent-looking zero, not a real result).
- GOTCHA: `benchmarks/humaneval-live/server/` (an HTML error page) and
  `benchmarks/humaneval-live/data/` (provider-health.json) are runtime
  byproducts, not project code — `server/` is deleted and `data/` is
  gitignored. Never commit them.

## M20 — verified coding capability

- STOCHASTIC BASELINE (important): the tool lane calls the model at
  `temperature 0.3` with **no seed**, so single small-n runs are not
  reproducible. Proof: commit `4e6d0e5`, locked ollama, SAME 5-task slice →
  preserved artifacts show 0/5 (23-21-22), 1/5 (23-51-13), 0/5 (00-09-03). The
  documented M19 "1/5" is one draw. Report rates with a variance band; prefer
  **paired** designs (same task, first attempt vs repaired attempt) over
  matching a single baseline number.
- MEASURED (M20, 15-task slice, llama3.2:3b, locked, `ladderSlid=0`):
  tool-execution reliability is materially better than coding. Only 6/15 tasks
  emitted a tool call at all; the one PASS (HumanEval/7) came through the M19
  alias bridge (`code_write`→`fs_write`, recovered from prose). 13/15 written
  files parsed; **1/15 (6.7%)** passed the official test. Dominant failure =
  model ceiling (9/15 produced no usable call / wrong code), NOT a JEXI defect.
- M19 fixes confirmed on the wire: alias bridge produced the pass; the
  write-payload normalizer fired on HumanEval/3 and /13 (both still failed for
  other reasons — the normalizer cannot make wrong code right). `fs_write`
  correctly BLOCKED two out-of-sandbox paths (`path escapes root`, HE/0 & /14).
- BOUNDED REPAIR (new): `benchmarks/humaneval-live/lib/repair.mjs`
  (`runBoundedRepair`, `MAX_REPAIRS=2`) + `m20-repair.mjs` driver. Seam is
  injected `runAttempt`/`grade`/`makeRepairContext` (deterministic tests).
  Guarantees enforced in code: ≤2 repairs, OFFICIAL grader is the only arbiter
  (no self-grading), timeout/grader-error never a pass, failing-test output
  scrubbed, official test file never modified. Paired result on the same 15
  tasks: **A 1/15 (6.7%) → B 3/15 (20.0%), +13.3 pp, 2 recovered-by-repair, 0
  false successes**. CAVEAT: per-attempt repair rate ≈ base rate and the gain
  ≈ the ±1–2 task noise band, so it is directional, not conclusive.
- Benchmark path (`AgentLoop.js` via `runTaskWithJexi`) is SINGLE-PASS; the
  existing `CodingLoop.js` (`runCodingLoop`) is wired only into `Orchestrator.js`
  (`N.debugger`). M20 did not rewire the product path — it added a
  benchmark-level bounded loop reusing the real loop + official grader.
- Observability added (no behaviour change): `LLMClient.js` tags recovered calls
  with `{path, aliasedFrom}`; `AgentLoop.js` emits `tool/recovered` and forwards
  `recovery` on `tool/call`; `lib/agent.mjs` exports `buildQuery`/`taskPaths`,
  adds a `queryOverride` seam and returns raw `events`.
- Suites: **211/211 pass** (was 210; +1 M20 suite `test-m20-repair-loop.js`,
  9 tests). No pre-existing failure introduced.
- GOTCHA: a killed benchmark leaves the ollama `llama-server` child spinning
  down; wait for its instantaneous CPU to reach 0 (`/proc/<pid>/stat` fields
  14+15 delta) before relaunching, or the next run competes for CPU.

## M22 — code-generation correctness & structured output (2026-11-05)

- ROOT CAUSE for 3/15 benchmark tasks: `TmuxContext.js` emitted the raw `$TMUX`
  host socket path (`/tmp/openhands-agent-server-37/…`) into every prompt. The
  small model read it as the file to write and `fs_write` refused with `path
  escapes root`, so the task ended unwritten. Fixed: `tmuxContextBlock()` no
  longer emits the path (assembled prompt 25178 → 25094 chars).
  `test-dsh-batch7.js` had ASSERTED the leak (`block.includes('default')`) and
  now asserts the path is ABSENT — a test that pins a defect is worse than none.
- D1 (new): `verifiers/SyntaxVerifier.js` + pure `analysis/python-structure.js`.
  In a Python sandbox lint is INAPPLICABLE (ESLint is a JS linter) and unit was
  UNVERIFIABLE (exec-style HumanEval file ≠ pytest), so NOTHING checked the
  bytes before the turn ended. The syntax layer runs the real compiler
  (`ast.parse` — no `__pycache__` side effect) and then the structural reader
  for shapes the compiler ACCEPTS but the task rejects: a body wrapped in
  `"""`, a duplicate `def`, a placeholder/absent entry point.
- D5: `TestVerifier` gained a real exec-style runner (`check(candidate)` files)
  with priority over detected pytest; the detector requires column-0 `check(`.
- D6 (new, found while fixing D1): STALE BYTECODE. CPython validates a cached
  `.pyc` by `(mtime, size)` with 1-second mtime granularity, so an edit that
  keeps the file's size and lands in the same second reuses the PREVIOUS
  bytecode. Measured: reverting a one-character fix (`+`→`-`) made the run
  report "1 passed" for a file that was failing on disk — a verifier FALSE PASS.
  Fix in `spawn/execute.js`: every spawned verifier gets a fresh private
  `PYTHONPYCACHEPREFIX` dir, removed on exit. `PYTHONDONTWRITEBYTECODE`/`-B`
  alone is NOT enough — it stops WRITING a cache, not READING an existing one
  (verified: `-B` still served a stale `.pyc`). Regression test M22/D6 fails
  without the fix.
- Structured verify declaration: `services/agent/verify-config.js`
  (`parseVerifyLayers`, `extractEntryPoint`) + the `CODE_VERIFY` env seam /
  `opts.verifyLayers`; the harness declares `syntax,unit`. This only chooses
  WHICH real verifiers run — every gate, honesty rule and refusal still applies.
- WS5: `m21-probe.mjs` now writes `<runId>.transcript.json` holding the
  COMPLETE answer, solution bytes and event list per task. The row table kept
  only `answerHead`/`answerTail`, so the generated code was discarded and could
  not be recovered without a ~3-minute re-run of a stochastic model.
- Suites: **212/212 pass** (was 211; +1 M22 suite
  `tests/agi/test-m22-code-correctness.js`, 33 tests: D1/D3/D4/D5/D6). Lint 0
  errors. The three "verifyAfterEdit" tickets triaged against a pristine
  worktree at `43d518f` (NOT the mislabeled log):
  `tests/tickets/jexi-e2e-planted-pytest.test.js` — baseline pass/fail over 4
  runs = 2/2/3/3, i.e. **JEXI-002/013 is FLAKY ON BASELINE** (fails ~half the
  time) and **JEXI-008/029 fails on baseline every time** (PRE-EXISTING,
  `the real pytest suite must be green after the loop`). With M22: 3/3/3/3 —
  JEXI-002/013 stable green (the flake WAS the stale-bytecode bug), JEXI-008/029
  unchanged.
- GOTCHA: a benchmark started BEFORE an edit keeps running the OLD module graph
  (Node caches modules per process). Label a baseline run by the commit it
  actually ran at, not by the log filename you gave it — a "baseline" log can
  silently be a post-fix run.
- MEASURED (M22, same 15-task slice, llama3.2:3b, locked, prompt A, fs-names):
  **0/15 verified passes** — unchanged from the M20/M21 baseline. What MOVED is
  delivery, and the verification signal that M21 lacked:
  `wrote 3/15 → 10/15`, `valid tool-call tasks 5/15 → 11/15`,
  `tool executed 4/15 → 10/15`, and the syntax layer now emits a REAL
  `verification failed after fs_write … (syntax): Python syntax error: …`
  which is fed back into the next tool result (M21 emitted nothing here).
  Residual attribution of the 15 final solutions (re-measured by
  `ast.parse` + the OFFICIAL test): **8/15 still do not parse** (7 of those 8
  are the SAME `unterminated triple-quoted string` / `expected an indented
  block` shapes) and **7/15 parse but are logically wrong** — independently
  re-graded, every parsing solution dies on `NameError: name '<entry>' is not
  defined`, i.e. the model never defined the required function. So the binding
  constraint is now the MODEL (llama3.2:3b cannot emit valid Python for these
  tasks), not the harness: the loop is correctly armed (edit → verify → replan),
  detects the failures, and reports them honestly instead of claiming success.
- TIMEOUT NOTE: 4/15 hit the 300 s per-task cap in M22 (vs 0 in the short
  baseline). The verify→replan loop makes a failing turn RETRY, so turns run
  longer; with `recovered=10 tools=11` on HumanEval/13 the model was actively
  thrashing. Raise `--timeout` or cap the replan rounds before drawing
  conclusions from a timeout count.
- HONESTY CHECK (do this before claiming a pass-rate change): re-run the
  OFFICIAL test yourself on the transcript's `solution` bytes. `pass` in the
  row table is the harness's own grader; a `NameError`/`SyntaxError` from an
  independent run is the ground truth.
