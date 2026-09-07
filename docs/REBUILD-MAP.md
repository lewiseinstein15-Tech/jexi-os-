# ARENA REBUILD — AUDIT & BUILD MAP

**Date:** Sept 2026 · **Base:** remote main `47ed4a0` (the live-proven deployed brain)
**Rule from Lewis:** audit first, rebuild structure, no fake anything, NO PUSH until Lewis says "PUSH AND COMMIT TO GITHUB".

## Status legend
✅ EXISTS (works, keep) · 🔶 PARTIAL (extend/rework) · ❌ MISSING (build new)

## The 38 parts vs reality

| # | Spec part | Status | What's actually there / what's needed |
|---|---|---|---|
| 1 | Core objective (executive system) | 🔶 | Lanes exist (mission → director → planner → agent loop); they're separate worlds — unify under one kernel |
| 2 | Performance structural fix (no LLM chains) | ❌ | Chat pays director-interpret LLM before anything; must add deterministic gate in front. **TOP PRIORITY** |
| 3 | Fast path (hello = free/1 call) | 🔶 | Greeting regex exists in Planner but the Director lane runs FIRST and pays an interpret call. Move fast-path BEFORE all lanes |
| 4 | Executive Kernel | ❌ | Identity/policies scattered across 30+ services. Build JexiKernel: one control layer owning turn routing, interrupts, mission registry, policy |
| 5 | Intent Engine | 🔶 | analyzeIntent: deterministic regex cascade + 1 LLM classify when unsure — good bones, wire it into Kernel as the gate |
| 6 | Reasoning Engine / ModelRouter / Ollama | 🔶 | LLMClient + ProviderRouter + 9 providers exist. Add OllamaProvider (HTTP, endpoint-configurable, OFF by default) — no OpenAI dependency |
| 7 | Context Engine | 🔶 | PromptAssembly/Compaction/MemoryLayers exist; audit per-call context size, add task-scoped assembly + measurement |
| 8 | Work Graph | ✅ | TaskGraph.js (built last build): tasks, dependsOn, persistence, timelines |
| 9 | Scheduler | 🔶 | TaskGraph has bounded concurrency; unify with existing TaskScheduler/GoalJobQueue; add pause/resume |
| 10 | Async parallel execution | ✅ | TaskGraph runs independent tasks concurrently |
| 11 | Mid-task steering | 🔶 | B208b replan + interrupt tools exist for missions; extend to Kernel level for ALL lanes (preserve work, cancel obsolete) |
| 12 | Multiple missions | ✅ | MissionRunner with persistence, recovery, chat-as-view |
| 13 | Agents (few, capable) | 🔶 | 252 roster (too many to be meaningful); capability-based selection exists; consolidate to ~12 core workers + capability routing |
| 14 | Capability Router | ✅ | Built last build: intent+query → minimum tools, both lanes |
| 15 | Tool Registry | ✅ | 218 tools, schemas/permissions/health |
| 16 | MCP as connectors | ✅ | 42 servers through one gateway; breaker, tree-kill, lazy wake |
| 17 | Browser/Computer use | ❌ | Browser trio MCPs unusable on free brain (BROWSER-PLAN). Build Browser Router (Android worker / desktop worker / remote worker) — the phone-browser idea becomes real architecture |
| 18 | JEXI Market external provider | ✅ | ExternalProviders with not-connected placeholder, one-way rule |
| 19 | Memory Vault | 🔶 | MemoryManager (68K) exists; add lifecycle (FRESH→AGING→STALE→REVERIFY) + confidence/freshness fields on retrieval |
| 20 | Observer | 🔶 | EventLog/ChatEventLogger/telemetry exist; unify event names to spec taxonomy, expose per-request metrics |
| 21 | Verification | ✅ | VerificationLoop + anti-fabrication verifier in missions |
| 22 | Recovery | ✅ | Retries, backoff, circuit breakers, replan ladder (B208b) |
| 23 | Self-improvement | ✅ | Architect sandbox flow; keep validation gates |
| 24 | Real JEXI conversation from events | 🔶 | narrate() exists in director lane; build Event Interpreter → JEXI voice for ALL lanes, personality-aware |
| 25 | Final UI (conversation is hero) | ❌ | 47 components, 4 views; conversation cluttered with cards in places; rebuild layout clean |
| 26 | Warm palette (orange/coral/salmon, dark) | ❌ | Currently NEON GREEN #00D26A — full palette swap |
| 27 | Handwriting for JEXI voice | ❌ | No handwriting font anywhere; add mature handwritten face for JEXI dialogue only (not code/logs) |
| 28 | Desktop (left nav, central conversation, right mission panel) | ❌ | Current = 4-icon switcher; rebuild as spec'd nav: Home/Missions/Memory/Tools/Files/Settings |
| 29 | Phone (hamburger ☰, no bottom bar) | ❌ | Current has bottom-ish nav; rebuild: hamburger drawer, conversation + input always accessible |
| 30 | Meaningful animation | 🔶 | Streaming + some transitions exist; keep subtle, tie to real events only |
| 31 | User profile | 🔶 | Memory has profile data; wire the Lewis profile (owner, Kibabii, phone-first, Noctryx distinction, "Boss") into Kernel identity + memory |
| 32 | Personality (executive partner) | 🔶 | JexiIdentity exists; strengthen: no "Sure!", context-mirrored tone |
| 33 | Owner relationship ("Lewis built me") | ✅ | JexiIdentity already answers this; keep technical auth enforcement |
| 34 | Security permissions | ✅ | Permission boundaries, grants, destructive authorization, owner auth — real |
| 35 | Testing matrix | 🔶 | 4,032 checks exist; add the spec's scenario matrix + performance benchmarks |
| 36 | UI evidence (real screenshots) | ❌ | Plan: run app locally, Playwright screenshots (desktop+phone+menus+conversation) |
| 37 | No push until approval | ⚠️ | Standing rule this build — nothing gets pushed until Lewis says the words |
| 38 | Definition of done | ⚠️ | Track in this doc; every item needs real evidence |

## Build order (engineering sequence)

**PHASE 0 — Base & audit** (this session): git base reconciled to deployed truth; old lineage preserved in `arena-backup-b216-b218` branch + stash. THIS DOC.

**PHASE 1 — Executive Kernel + Fast Path** (the structural speed fix):
- JexiKernel: single turn entry — greeting/smalltalk/deterministic commands resolved with ZERO or ONE small LLM call, before any lane
- Model-call accounting: every request logs calls/latency per stage (kernel/intent/execution/verify)
- OllamaProvider added (endpoint-based, off by default, provider-agnostic)

**PHASE 2 — Work Graph as THE mission engine**: missions build TaskGraphs; scheduler unified; mid-task steering at kernel level (preserve done work, cancel obsolete, replan affected).

**PHASE 3 — Browser Router**: JEXI → Capability Router → Browser Router → Android worker (phone WebView via the APK) / desktop worker / remote worker. Honest fallback when no worker is connected. Observable ("Boss, I'm opening the page now").

**PHASE 4 — Memory Vault lifecycle + Event Interpreter (JEXI voice)**: freshness states, meaningful conversational updates from REAL events only.

**PHASE 5 — Full UI rebuild**: warm palette, handwriting voice, desktop nav + phone hamburger, conversation as hero, subtle status, animation tied to real events.

**PHASE 6 — Test matrix + benchmarks + real screenshots + README** — then STOP, show Lewis, wait for "PUSH AND COMMIT TO GITHUB".

## Notes / risks (honest)
- The phone-browser worker (Phase 3) needs APK changes + a live channel (FCM push or WebSocket). Real work, not mock.
- 252 agents → 12 is a destructive consolidation; keep the roster file as data but route through capabilities (no deletions of working code).
- Neon-green → warm palette touches every component; do it as CSS-variable swap + component pass, not a rewrite of working logic.
- Everything ships behind the existing test chain; no push until approved.
