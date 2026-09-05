# JEXI OS — AGI + API-INDEPENDENCE ROADMAP

> Phase 0 deliverable. Governing plan for the architecture upgrade. Anchored
> to the mission spec's phases 0–10, with the honest current state of each.
> Rule that never changes: every phase ends with tests green, benchmark
> re-recorded, docs updated, committed, and a factual report of what changed
> and what remains. No capability is ever claimed without implementation +
> tests. No local model hosting — JEXI's intelligence comes from remote
> providers, never a single one.

## Where each phase stands (2026-09-05)

| Phase | Deliverable | Status |
|---|---|---|
| 0 | Audits + research docs | **DONE** — this doc, `JEXI_CURRENT_ARCHITECTURE.md`, `research/{MCP,AWESOME_MCP_SERVERS,HERMES,ANTIDOOM,PURO_RESEARCH,OBLITERATUS}.md`; prior `AGI_ARCHITECTURE.md` |
| A+B | Scored benchmark + epistemic vocabulary | **DONE** (commit e3edbc3, 8cd2ba6) — 6 axes @ 1.000; KNOWN/LIKELY/UNCERTAIN/UNKNOWN/CONTRADICTED claim algebra live |
| 1 | API independence | **IN PROGRESS (1/6 done)** — ProviderHealthManager + error taxonomy + persistence + dashboard endpoint shipped; budgets, cache, dedup, dashboard UI remain |
| 2 | MCP gateway + registry | **IN PROGRESS** — client+server exist; registry/trust/permissions wiring remain |
| 3 | Tool unification | PARTIAL — ToolRegistry + ToolProfiles + ToolDiscovery exist; MCP/browser/computer/agent tools not yet one interface |
| 4 | World model + memory layers | PARTIAL — WorldState (mission-scoped), MemoryManager, Lessons; global model + layers remain |
| 5 | Work Graph + planning | **LARGELY DONE** — WorkGraph, budgets, resume, replan (tested) |
| 6 | Browser / computer use | **LARGELY DONE** — observe→act→verify, honest degradation, CAPTCHA stop |
| 7 | Verification + failure recovery | **LARGELY DONE** — Verifier gates, failure ladder, lessons; hypothesis engine is basic |
| 8 | Skills + learning | PARTIAL — skills screen/roster skills exist; versioned skill artifacts + validation remain |
| 9 | Imagination engine | PARTIAL — PREDICTED vs ACTUAL exists; multi-plan simulation + risk comparison remain |
| 10 | Evaluation expansion | PARTIAL — 6-axis benchmark gates the chain; full task suites (10×6 categories) remain |

## Phase 1 — API independence (highest priority)

Already in place (tested): provider-fanout `generateContent`, exponential
backoff with jitter (B133), retry-after hint parsing + quarantine +
health-ordered provider walking (B220), retired-model self-healing (B177/219),
per-provider rate-limiter slots.

Remaining, in order:

1. ~~**ProviderHealthManager**~~ **DONE (2026-09-05)** —
   `src/services/ProviderHealth.js`: structured states, error taxonomy
   (RATE_LIMITED / QUOTA_EXHAUSTED / AUTH_ERROR / CONTEXT_TOO_LARGE /
   MODEL_NOT_FOUND / TIMEOUT / OVERLOAD / SERVER_ERROR / NETWORK / UNKNOWN),
   success-rate + latency EWMA, consecutive-failure cooldown scaling (capped,
   retry-after overrides honored), STICKY auth errors, disk persistence,
   `GET /api/providers/health` dashboard endpoint; wired into both LLMClient
   provider walks (success/failure recording + skip-while-unhealthy).
   Tests: `tests/agi/test-provider-health.js` (14); benchmark robustness
   axis extended to 8 checks.
2. **Request budgets** — per-task {model calls, tokens, time, retries};
   mission budgets extend to model consumption; budget-aware model choice
   (small/cheap for routine, strong for reasoning) via the capability matrix.
3. **Response cache** — keyed by (model, messages hash, params); TTL +
   explicit invalidation; never caches anything that must be fresh (time,
   search results, tool state).
4. **Request deduplication** — in-flight map so N agents asking the same
   thing share one call.
5. **Deterministic-first rule** — audit remaining LLM call sites; replace
   model calls that merely check facts a tool can check (file exists, JSON
   valid, git status). Reserve models for reasoning/interpretation/planning.
6. **API-limit dashboard** — admin view: provider, status, requests, success,
   failures, 429s, latency, cooldown, last success/failure.

## Phase 2 — MCP gateway

Keep and harden what exists (official-SDK server; McpClient with stdio +
streamable-http). Add: `mcp/registry.json` (name, description, transport,
endpoint, enabled, trustLevel, permissions, health); permission boundaries
READ_ONLY / LOCAL_WRITE / NETWORK / EXECUTION / GIT / DEPLOYMENT /
DESTRUCTIVE; discovery results flow through ToolDiscovery so planning sees
MCP tools with the same capability matching as native tools; per-server
timeouts + health + lifecycle. Start with a SMALL trusted set (see
`research/AWESOME_MCP_SERVERS.md`).

## Phase 3 — Tool unification

One `Tool` interface (id, description, schema, source, permissions, risk,
timeout, cost, verification, execute()) with sources: native, MCP, browser,
computer, API, agent. ToolRegistry becomes the single catalog;
ToolProfiles govern permissions uniformly; the planner reasons about
capabilities, not implementations.

## Phase 4 — World model + memory layers

Global WorldModel (users, projects, files, repos, sites, APIs, tools, goals,
constraints, dependencies, events, results, uncertainties) — mission
WorldState becomes a scoped view. Memory layers (working/episodic/semantic/
procedural/user) over existing stores — reorganized behind one interface,
nothing replaced. Provenance + confidence via Phase B Epistemics everywhere.

## Phase 5 — Planning (complete the remainder)

Already: decomposition, dependencies, priorities, budgets, checkpoints,
resume, replan. Remaining: iterative re-planning checkpoints mid-mission
(planned cadence, not only on failure), rollback semantics for destructive
steps.

## Phase 6 — Browser/computer use (complete the remainder)

Already: observe/navigate/click/type/scroll/select/upload/download/screenshot/
inspect/verify, recovery, login/CAPTCHA detection with human handoff.
Remaining: richer page-state understanding, download verification, deeper
Hermes-inspired reference checks (see research/HERMES.md).

## Phase 7 — Verification + failure recovery (deepen)

Already: gates, evidence, execution honesty, failure ladder, lessons.
Remaining: structured hypothesis generation/testing loop with explicit
EXPECTED vs ACTUAL records in the world model; confidence attached via
Epistemics.

## Phase 8 — Skills

`skills/` artifacts: name, description, requirements, procedure, tools,
examples, failure modes, verification — versioned, validated (tested before
promotion), permission-checked. Skill learning = extracting procedures from
successful missions (Lessons generalize into skills). No uncontrolled
self-modification of production code.

## Phase 9 — Imagination

Multi-alternative plan simulation before expensive/risky actions; score by
expected success, cost, risk, reversibility; predictions stored as
PREDICTED (Phase B guarantees they can never masquerade as observations).

## Phase 10 — Evaluation expansion

Grow `tests/agi/benchmark.js` + `evaluation/` suites: 10 short, 10 multi-step,
10 unfamiliar, 10 failure-recovery, 10 tool-discovery, 10 memory-transfer
tasks with expected outcomes, constraints, success/failure criteria. Track in
`AGI_BENCHMARK.md`. Never fabricate scores. Deterministic axes gate CI;
model-dependent suites run separately, keyless where possible.

## Standing rules (never change)

- No local model hosting. No single-provider dependence.
- Never claim AGI; report capability + tests + limitations.
- Preserve personality, UI, streaming, agents, search, memory, notifications,
  existing APIs and user experience. Strangler pattern for refactors.
- Model calls are a limited resource: deterministic tools first.
- Real events only in the UI — no fake progress.
- Destructive actions require authorization; audit everything.
