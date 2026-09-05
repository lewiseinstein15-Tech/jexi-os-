# JEXI OS — Current Architecture (audited 2026-09-05)

> Phase 0 deliverable of the AGI + API-independence upgrade. This documents
> what EXISTS today, verified against the repository — not what is planned.
> Companion docs: `AGI_ARCHITECTURE.md` (capability audit), `JEXI_AGI_ROADMAP.md`
> (plan), `research/` (reference-project studies). Statuses are TESTED (covered
> by the test chain), PARTIAL (works, unarchitected/uncovered), MISSING.

## 1. Shape of the system

```
Android APK (Capacitor)   PWA / GitHub Pages        (frontend — React + Vite)
        └────────────┬────────────┘
                     │ HTTPS + x-jexi-key
                     ▼
        JEXI BRAIN — Node.js (server/, port 3002)
        ├── index.js (~2.4k lines) — HTTP surface, SSE, 3 execution paths
        ├── src/services/* — 60+ services
        ├── src/services/director/* — autonomy stack
        └── data/ (DATA_DIR) + Upstash Redis mirror (persistence)
```

- **Frontend**: React + Vite SPA (`src/`), shipped as PWA (GitHub Pages) and
  real Android app (Capacitor wrapper built by GitHub Actions, `apk.yml`).
  Screens: chat, missions, roster, memory, models, MCP, skills, settings.
- **Backend**: single Node process (`server/index.js`), Express-style routing
  hand-rolled, SSE streaming, everything in ESM.

## 2. Execution paths (how a user request runs)

Three parallel paths, selected by lane logic (this is the known tech debt the
roadmap's CognitiveCore phase addresses):

1. **SimpleTask lane** (`runLegacyPipeline`, index.js ~:1753) — direct task.
2. **Graph lane** — Planner → WorkGraph of employee nodes (Orchestrator).
3. **Director lane** (`directorTurn`, index.js ~:1875/:1928) — missions.

## 3. Agents & orchestration

- **Roster**: 252+ employees with skills/departments (`RosterService`,
  `selectEmployee(['capability'])`), workers are specialized but coordinated.
- **Orchestrator** (`src/services/Orchestrator.js`): builds node graphs,
  routes work to employees, carries images (B227 vision fix).
- **WorkerRouter / AgentLoop / SimpleTask**: lane-specific execution.
- **Director** (`director/Director.js`): mission planning, `dependencyWaves`,
  replan, steering, HITL gates, budget enforcement.
- **MissionRunner** (`director/MissionRunner.js`): executes WorkGraphs,
  verify→lesson loops, verification stamped KNOWN/verified (Phase B).

## 4. Planner, Work Graph, verification, recovery

- **Planner** (`Planner.js`, zod-validated) — produces subtask plans.
- **WorkGraph** (`director/WorkGraph.js`) — TESTED: deterministic ready-work
  (priority desc, createdAt asc), BLOCKS relations, claims/leases with TTL,
  atomic persistence, exact reload, SIGKILL-resume.
- **Mission** (`director/Mission.js`) — state machine (CREATED…COMPLETED with
  legal transitions), budgets (maxItems/maxFailures/wallClock), steering
  queue, AWAITING_INPUT, verification record.
- **Verifier** (`director/Verifier.js`) — TESTED deterministic gates:
  acceptanceGates (empty/refusal/substitute/short), method provenance
  (claimsBrowserMethod vs executionEvidence — fabricated browser use fails),
  execution honesty (claimed commands with zero COMMAND_* events = fabrication).
- **Failure ladder** — failures → hypotheses → alternative strategy; demotion
  after repeated failure; `Lessons.js` records failure/recovery lessons
  (MAX_LESSONS=300, retrieved cross-domain — benchmark transfer axis).
- **ImaginationEngine** — PREDICTED vs ACTUAL comparison (predictions kept
  separate from observations; Phase B hardens the boundary).

## 5. Memory & world state

- **MemoryManager** — conversations, books, project memory, preferences,
  vector search; context resolution + compaction (JEXI_COMPACTION_TOKENS).
- **WorldState** (`director/WorldState.js`) — mission-scoped environment
  record (files/processes/browser/repos/network), atomic writes,
  Phase B: every observation stamped `epistemic:'KNOWN', how:'observed'`.
- **Epistemics** (`director/Epistemics.js`, Phase B) — KNOWN/LIKELY/
  UNCERTAIN/UNKNOWN/CONTRADICTED claim algebra with hard promotion rules.
- **Lessons** — experience store feeding future planning.
- Gaps: no global world model, no explicit memory layers (working/episodic/
  semantic/procedural/user), no decay/consolidation.

## 6. Model providers & API-limit behavior (Phase 1 baseline)

- **Providers** (LLMClient.js): Gemini, Groq, OpenRouter, DeepSeek, Cerebras,
  DeepInfra, xAI, Mistral, HuggingFace (+ custom base URLs). ~9-13 lanes
  depending on counting; all behind one `generateContent()` interface.
- **RetryPolicy.js (B133, TESTED)**: exponential backoff 500ms·2^n (cap 8s)
  + ≤250ms jitter, max 3 attempts, retryable = 429 / 5xx / network / timeout;
  wraps the fetch INSIDE generateContent so every provider benefits.
- **B220 (TESTED)**: retry-after side channel — parses "Please retry in 46.8s"
  (Gemini/Groq/OpenRouter), `noteProviderFailure` honors the hint; providers
  that keep failing are quarantined (3 failures → 30s) and drop to the back
  of the health-ordered walk; rate-limiter slots gate per-provider pressure.
- **Model self-healing**: retired-model detection → live-model discovery and
  single retry (B177); Groq dead-model cache (B219).
- **Gaps for Phase 1**: no structured ProviderHealthManager (states are
  implicit in maps, not queryable/persisted/dashboarded), no per-task request
  budgets (model calls/tokens/cost), no response cache, no in-flight request
  deduplication, provider metadata not a first-class registry.

## 7. Tools, search, MCP

- **ToolRegistry** (`ToolRegistry.js`) — native tools with
  descriptions/schemas; **ToolProfiles** (ToolRuntime.js :571) —
  auto/ask/full × safe/medium/risky permission profiles; audit trail.
- **ToolDiscovery** (`ToolDiscovery.js`) — TESTED: deterministic,
  capability-matched discovery, no hard-coded request→tool mappings,
  honest gaps (benchmark generalization axis).
- **Search**: multi-provider web search, diversity checks, news topics,
  domain verification.
- **MCP — JEXI runs a server** (`server/mcp-server.js`): official SDK,
  read-mostly exposure of JEXI's own tools, `ask_jexi` is the only action
  tool, no destructive tools, MCP_PORT.
- **MCP — JEXI connects as a client** (`src/services/McpClient.js`):
  stdio + streamable-http transports, reconnect policy, tool listing/status;
  frontend McpScreen. Gaps: no unified registry with trust levels/permissions
  per server, no wiring of MCP tools into ToolDiscovery/permissions seams.

## 8. Computer use & browser

- **ComputerRuntime / ComputerOps** — observe→act→verify loop with screenshots;
  `JEXI_NO_BROWSER` honest degradation; COMPUTER_USE_MAX_ATTEMPTS budget.
- Playwright-based browser; CAPTCHA/auth walls stop and ask (no bypass).
- E2B sandbox option; Android device bridge (ANDROID_ADB / JEXI_ANDROID_SERIAL).

## 9. Streaming, notifications, auth, persistence

- **Streaming**: SSE with REAL system events only (no fake thinking), frame
  format proven in B226; mission event stream (missionStream.js).
- **Notifications**: NotificationCenter + GoalNotifier (email goal reports,
  GOAL_REPORT_EMAIL).
- **Auth**: single access key (`x-jexi-key` header; JEXI_API_KEY /
  key set via Settings) — locked server returns 401; CORS_ORIGINS allowlist.
- **Persistence**: JSON files under DATA_DIR (atomicWrite), Upstash Redis
  mirror for mission survival across container replacement (B217/B218),
  hydrate-retry on boot; Firebase service account (Android push);
  GitHub App/token for repo operations; workspace repos on disk.

## 10. Environment variables (selection)

Provider keys: GEMINI_API_KEY, GROQ_API_KEY, DEEPSEEK_API_KEY,
CEREBRAS_API_KEY, DEEPINFRA_API_KEY, XAI…, MISTRAL…, OPENROUTER…, HF_TOKEN.
Integrations: GITHUB_TOKEN / GITHUB_APP_ID / GITHUB_PRIVATE_KEY /
GITHUB_WEBHOOK_SECRET, FIREBASE_SERVICE_ACCOUNT(_B64), E2B_URL, UPSTASH_*.
Behavior flags: DATA_DIR, CORS_ORIGINS, JEXI_NO_BROWSER, JEXI_CHAOS,
JEXI_COMPACTION_TOKENS, COMPUTER_RUNTIME, COMPUTER_USE_MAX_ATTEMPTS,
JEXI_HYDRATE_RETRY_DELAYS_MS, DESKTOP_ALLOW_PRIVATE, JEXI_ALLOW_UNLOCKED…

## 11. CI/CD & quality gates

- `server/package.json` test chain: ~46 suites (~500s), EXIT=0 required.
  Includes autonomy suites (long-horizon, failure-injection, backend-restart,
  browser-disconnect), B-contracts, and since Phase A the scored
  `tests/agi/benchmark.js` (6 axes, chain-gated at 0.90) + Phase B
  `tests/agi/test-epistemics.js`.
- GitHub Actions: CI, Deploy Frontend to Pages, Publish Docker image,
  Build JEXI OS APK (all 4 green on every push).
- Render deploy (brain), UptimeRobot keep-warm, Pages self-heal guard.

## 12. Honest summary of gaps (feeds the roadmap)

Missing or partial: unified CognitiveCore (3 parallel paths), global world
model, memory layers with decay/consolidation, self-model/capability ledger,
curiosity/information-gain, procedure abstraction for transfer, structured
provider health + budgets + caching + dedup (Phase 1 remainder), MCP registry
with trust levels wired into permissions (Phase 2 remainder), skills
system as versioned artifacts (Phase 8), imagination beyond single-plan
prediction (Phase 9), dashboard for API limits (Phase 1), benchmark suite
expansion beyond the 6 deterministic axes (Phase 10).
