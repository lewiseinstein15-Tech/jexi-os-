# JEXI OS — AGI Architecture Audit & Implementation Plan

> Status vocabulary used throughout (the honesty contract):
> **TESTED** — built AND verified by a passing automated test (cited).
> **DESIGNED** — built, not fully covered by tests.
> **EXPERIMENTAL** — exists, known limits documented.
> **MISSING** — does not exist. Never claimed.

This document is the Phase 1 deliverable of the general-intelligence upgrade.
It audits the repository as it exists (through B227), maps the 28-point
architecture specification against reality, and lays out the phased plan for
the genuine gaps. Working components are preserved — the plan extends and
unifies them; it does not rewrite them.

---

## 1. Current architecture (as built)

```
                        ┌──────────────────────────────────────────────┐
                        │                 FRONTEND (React)             │
                        │ 21 views · SSE live events (real only) ·     │
                        │ mission instrument · computer panel · mic    │
                        └───────────────┬──────────────────────────────┘
                                        │ /api/* (x-jexi-key or ?key=)
        ┌───────────────────────────────┴───────────────────────────────┐
        │                        SERVER (Express)                       │
        │  auth middleware · rate limits · NDJSON/SSE streaming         │
        └──┬────────────────────────────────────────────────────────────┘
           │
   ┌───────┴───────────────── THREE EXECUTION PATHS (see §6 risk) ─────┐
   │                                                                   │
   │  A. SIMPLE lane      SimpleTask → WorkerRouter → LLMClient        │
   │     (single coworker, native tools, fast)                         │
   │                                                                   │
   │  B. GRAPH lane       Planner → typed-state Orchestrator graph     │
   │     (contextResolve → memoryRead → planner → router → specialist  │
   │      nodes → replanner → responder)                               │
   │                                                                   │
   │  C. DIRECTOR lane    Director: interpret → plan → staff →         │
   │     delegate → supervise → verify → report                        │
   │       └─ MissionRunner: persistent WorkGraph loop                 │
   │            (ready-work → execute → verify → ingest discoveries    │
   │             → steer → checkpoint; SIGKILL-safe resume)            │
   │                                                                   │
   └──┬────────────────────────────────────────────────────────────────┘
      │
   ┌──┴──────────────────────── SHARED SUBSYSTEMS ─────────────────────┐
   │ LLMClient/ModelRouter — 13 providers, 9-rung telemetry-informed   │
   │   fallback, vision lanes, free-tier pacing, retry-after awareness  │
   │ ToolRegistry + ToolRuntime — 23+ tools, risk tiers, permission    │
   │   profiles (auto/ask/full × safe/medium/risky), B52 allowlists    │
   │ ToolDiscovery — objective → capability → tool, honest gaps        │
   │ ComputerRuntime — local/remote/docker/adb-android/mock providers  │
   │ MemoryManager — Redis-mirrored episodic + semantic (vector) store │
   │ Lessons — failure→cause→strategy→lesson, retrieved into plans     │
   │ WorldState — mission-scoped real environment record               │
   │ Verifier — deterministic acceptance gates + evidence-grounded     │
   │   rubric; ACTION COMPLETED ≠ OBJECTIVE VERIFIED                   │
   │ EventLog — auditable coworker_call/result + orchestrator decisions│
   │ AgentRoster (252+) + AgentMail — structured task contracts        │
   │ ImaginationEngine — bounded counterfactual strategy search        │
   └────────────────────────────────────────────────────────────────────┘
```

## 2. Current capabilities — the 28-point mapping (audited)

| # | Spec requirement | Status | Evidence |
|---|---|---|---|
| 2 | Central cognitive loop (understand→…→learn) | **PARTIAL** — the Director lane IS this loop (B208, B211); but three parallel paths exist and the loop is mission-scoped, not system-wide | `test-b211.js`, `tests/autonomy/*` |
| 3 | World model | **PARTIAL** — WorldState (B215) records real files/processes/browser/repos/network per mission; no global entity/relationship graph, no cross-session environment learning | `test-b215.js` |
| 4 | Multi-layer memory | **PARTIAL** — episodic (conversation events), semantic (vector memory + knowledge), procedural (Lessons, 300-capped), user (preferences/profile) all EXIST; not architected as layers; no decay/consolidation/conflict/confidence | `test-memory-*.js`, `test-b211b2.js` E/K |
| 5 | Reasoning engine (stages, hypotheses, revision) | **PARTIAL** — complexity analyzer, imagination branches, evidence-grounded verification, replan-once; stages are real but distributed; no explicit hypothesis-comparison structure outside ImaginationEngine | `test-b211b2.js` A–H |
| 6 | Long-horizon planner | **TESTED** — decomposition, dependencies, priority order, budgets (items/failures/wall-clock/replans/discovery), checkpoints, replan | `test-b211.js` A/B, `tests/autonomy/long-horizon-mission.js` |
| 7 | Self-evaluation / verification | **TESTED** — deterministic gates (empty/refusal/short/fabricated-execution) run with no model; browser-method claims require real COMPUTER_ACT events; exit-0 ≠ success by design | `test-b210.js` (64 checks), `test-b211b3.js` D |
| 8 | Failure recovery + strategy demotion | **TESTED** — layered ladder (model 9-rung → RETRY/REASSIGN/ESCALATE → replan); provider rungs demote on failure (telemetry); recovery lessons stored & retrieved | `tests/autonomy/failure-injection.js` (all) |
| 9 | Tool autonomy (registry, dynamic selection) | **TESTED** — registry + discovery by objective (never "if X then tool Y"); risk + verification metadata; B52 allowlist respected; discovery composes assignments (B225) | `test-b223.js` (17), `test-b225.js` |
| 10 | Computer use (observe→act→verify) | **TESTED** — browser loop ≤3 rounds/≤4 actions with real observation between; adb-Android runtime (B225); honest COMPUTER_BLOCKED; real screenshots | `test-b211b3.js` F/I, `test-b225.js` |
| 11 | Learning loop (controlled) | **PARTIAL** — lessons update memory & future strategy; workspace checkpoints + rollback exist for code work; no formal sandbox policy for self-modification | `test-b211b2.js` E/K |
| 12 | Knowledge transfer (cross-task abstraction) | **PARTIAL** — lessons DO reach the next plan (proven cross-process); but lessons are mission-scoped natural language, not abstracted procedures | `tests/autonomy/failure-injection.js` 6 |
| 13 | Curiosity / information gain | **MISSING** — asks the user only when ambiguity+risk demand it (B211b2 I/J); no active "which observation most reduces uncertainty" process | — |
| 14 | Self-modeling | **PARTIAL** — runtimeCapabilities() (B215), roster/skills registry, provider telemetry, discovery gaps; no unified SelfModel with confidence | `test-b215.js` |
| 15 | Dynamic agent system (contracts, trust) | **TESTED** — capability-driven staffing, structured AgentMail contracts, exclusion logic, verification of coworker output by a separate verifier role | `test-b209.js` (92), `test-b211b3.js` C |
| 16 | Work Graph (persistent, resumable) | **TESTED** — typed relations (BLOCKS/DISCOVERED_FROM/SUPERSEDES/PRODUCES), leases, atomic tmp+rename persistence, SIGKILL→fresh-process resume, DONE never redone | `test-b211.js`, `tests/autonomy/backend-restart.js` |
| 17 | Imagination / simulation | **TESTED** — ≤3 branches, ≤2 LLM calls, SELECTED/REJECTED with reasons; PREDICTED vs ACTUAL deviation recorded; SIMULATION_UNAVAILABLE honesty | `test-b211b2.js` C/D/H |
| 18 | Context management | **TESTED** — compaction, per-agent memory loadouts, token-relevance retrieval, spill files | `test-compaction.js`, `test-memory-vector.js` |
| 19 | Model-agnostic Model Router | **TESTED** — 13 providers; per-domain preference; telemetry-informed order; free-tier pacing | `test-hermes-*`, `test-model-coworkers.js` |
| 20 | Safety/permissions/audit | **TESTED** — profiles auto/ask/full × safe/medium/risky; RiskGuard; outbound sends pause for ONE approval; every call/result in EventLog; rate limits | `test-b52.js`, `test-security-hardening.js` |
| 21 | Human-in-the-loop (ask only when needed) | **TESTED** — the gate fires only on unresolvable-and-risky; CRITICAL objectives wait for approval; otherwise autonomous | `test-b211b2.js` I/J |
| 22 | AGI evaluation system | **PARTIAL** — static 10-dimension audit (GENERAL_INTELLIGENCE_AUDIT.md) + pass/fail suites; **no scored, tracked benchmark** → built in this phase (§8) | this doc + `tests/agi/benchmark.js` |
| 23 | UNKNOWN / epistemic states | **PARTIAL** — provenance tags USER_STATED/INFERRED/ASSUMED/UNKNOWN (B215); honest degradation everywhere; no CONTRADICTED state, no confidence scores | `test-b215.js` |
| 24 | Real-event streaming UI | **TESTED** — SSE push (B224) replays/pushes real server events; the frontend invents nothing (row 30 of the matrix) | `test-b224.js` |
| 25 | Personality preserved | **TESTED** — identity prompt + warm/direct tone, honesty about limits | `test-identity.js` |

**What already exists is substantial.** The genuine gaps are: the unified
cognitive core (three paths), the global world model, the layered memory
architecture, active curiosity, procedure abstraction for transfer, the
unified self-model, epistemic statuses with confidence, and the scored
benchmark. These define the roadmap.

## 3. Missing capabilities (the honest list)

1. **Unified CognitiveCore** — one loop implementation all paths share.
2. **Global World Model** — cross-mission entity/relationship graph with
   uncertainty and environment learning (API down → represented as down).
3. **Memory layer architecture** — explicit working/episodic/semantic/
   procedural/user layers with decay, consolidation, conflict detection,
   provenance, confidence.
4. **Curiosity / information-gain** — goal-directed, resource-bounded
   uncertainty reduction.
5. **Procedure abstraction** — lessons generalized into reusable procedures
   ("when deploying anything: verify the live URL, not the exit code").
6. **SelfModel** — capabilities, limits, tools, compute, knowledge,
   uncertainties, recent failures, confidence; the "can I do this?" check.
7. **Epistemic status vocabulary** — KNOWN/LIKELY/UNCERTAIN/UNKNOWN/
   CONTRADICTED + confidence, used consistently across memory and reasoning.
8. **Scored AGI benchmark** with tracked results over time (this phase).

## 4. Proposed architecture (target)

```
USER
 ↓ PERCEPTION        (chat/stream/vision/computer events → normalized inputs)
 ↓ COGNITIVE CORE    (the ONE loop — Director generalized)
    ├─ CONTEXT ASSEMBLY   working memory ← world model + memory layers
    ├─ GOAL UNDERSTANDING ObjectiveInterpreter (provenance-tagged)   [exists]
    ├─ SELF-CHECK         SelfModel: "can I? what's missing?"        [new]
    ├─ REASONING          hypotheses, alternatives, contradictions   [extends Imagination]
    ├─ PLANNING           planner + budgets + discovery              [exists]
    ├─ WORK GRAPH         persistent graph, resumable                [exists]
    ├─ ACTION SELECTION   tools/agents by capability, not hard-coded [exists]
    ├─ EXECUTION          workers/computer-use, permission-gated     [exists]
    ↓ OBSERVATION       real results only (WorldState + events)      [exists, scoped]
 ↓ EVALUATION        Verifier: outcome vs objective, not exit codes  [exists]
 ↓ RECOVERY          diagnose → hypothesize → test → strategy        [extends ladder]
 ↓ LEARNING          lessons → procedures → memory update            [extends Lessons]
 ↓ MEMORY/WORLD UPDATE  decay · consolidation · confidence           [new]
 → NEXT ACTION (loop continues until the goal is verified done)
```

**Nothing here replaces the working subsystems.** The plan adds the four new
organs (World Model v2, Memory layers, SelfModel, Curiosity) and migrates the
three execution paths onto one CognitiveCore contract while keeping their
proven internals as strategies of that contract.

## 5. Data flow (target, one turn)

1. Input normalizes (perception) → CognitiveCore opens/loads the Work Graph
   for the active goal (resume if interrupted).
2. Context assembly pulls: working memory (active task state) + relevant
   episodic/semantic/procedural memory (ranked, decayed) + world-model
   entities touching this goal + SelfModel constraints.
3. ObjectiveInterpreter structures the goal (provenance-tagged).
4. SelfModel gate: capability/information sufficiency → if missing, either
   Curiosity picks the highest-information-gain observation, or the human is
   asked (only per §21 rules).
5. Planner decomposes; ToolDiscovery proposes; Imagination compares
   strategies (predicted vs later actual, kept distinct).
6. Execution through the permission-gated runtime; every action → real
   observation recorded in the world model.
7. Verifier gates the outcome (deterministic floor + evidence-grounded
   rubric); failures route through the recovery ladder and update strategy
   priors; successes/failures distill into lessons (and, later, abstract
   procedures).
8. Loop or finish; everything checkpointed; the UI streams the real events.

## 6. Agent / cognitive responsibilities

- **CognitiveCore (JEXI)** — owns the loop, the goal, the budget, the stop
  condition. Never delegates responsibility for the verdict.
- **Planner** — decomposition, ordering, budgets (exists).
- **Workers (252+ roster)** — specialized execution under task contracts;
  outputs are evidence, never verdicts (exists).
- **Verifier** — adversarial evaluation of deliverables (exists).
- **Computer-use (Atlas)** — observe→act→verify on real machines (exists).
- **NEW organs** — WorldModelKeeper (entity/relationship updates),
  MemoryConsolidator (decay/merge/conflict), SelfModel (capability ledger),
  CuriosityDirector (information-gain ranking).

## 7. Risks

- **Rewrite risk** — the three paths work and are heavily tested; unification
  must be strangler-pattern (new contract, migrate one path at a time, chain
  green after each).
- **Free-tier physics** — more cognitive stages = more model calls; every new
  stage must have a deterministic no-LLM floor (like the Verifier gates).
- **Fake-generality risk** — benchmark scores can be gamed by overfitting
  scenarios; scenarios must use unseen domains and adversarial fixtures.
- **Memory bloat** — layered memory without decay becomes a swamp; decay and
  consolidation ship WITH the layers, not after.
- **Honesty drift** — every new component must ship with its "honestly
  unavailable" path tested (the SIMULATION_UNAVAILABLE pattern).

## 8. Evaluation methodology (built in this phase)

`server/tests/agi/benchmark.js` — a scored, deterministic, keyless benchmark
harness wired into the test chain. Axes (per spec §22), each 0–1:

| Axis | Scenario (deterministic) |
|---|---|
| Generalization | structure + discover tools for an UNSEEN invented domain; honest UNKNOWNs, no fabrication |
| Planning | WorkGraph dependency order, budgets, out-of-order rejection, restart-resume state equality |
| Calibration | Verifier gates on labeled fixtures: empty/refusal/fabricated-method must FAIL; real work must PASS |
| Transfer | a lesson from one domain retrieved for a different-domain query and injected into plan context |
| Epistemic honesty | unavailable capability → honest gap; no invented tools or knowledge |
| Robustness | atomic persistence: mission state survives reload byte-for-byte; resume is exact |

Results are appended to `docs/AGI_BENCHMARK.md` (date, phase, per-axis
scores, overall). The chain gates on a threshold (0.90) so regressions in
generality fail CI exactly like regressions in code. Over time: add axes
(adaptation with injected environment change, autonomy length, curiosity
efficiency) as the phases land.

## 9. Implementation roadmap (phases, each ends chain-green + committed)

- **PHASE A (this change)** — audit doc (this file) + the scored benchmark
  harness + baseline results committed.
- **PHASE B — Epistemic spine**: the KNOWN/LIKELY/UNCERTAIN/UNKNOWN/
  CONTRADICTED vocabulary module + confidence scores, adopted by
  ObjectiveInterpreter, Lessons, and discovery gaps. (Small, foundational.)
- **PHASE C — World Model v2**: global entity/relationship store (people,
  projects, files, APIs, tools, goals, events, uncertainty) with real-action
  updates and environment learning (X failed twice → represented as
  unreliable, not retried blindly). Mission WorldState becomes a view of it.
- **PHASE D — Memory layers**: explicit working/episodic/semantic/procedural/
  user layers over the existing stores + decay/consolidation/conflict
  detection. No store replaced — reorganized behind one interface.
- **PHASE E — SelfModel + Curiosity**: capability ledger + the "can I?"
  gate; information-gain ranking for uncertainty reduction (resource-bounded).
- **PHASE F — Procedure abstraction**: lessons → generalized procedures with
  applicability predicates (transfer across domains), retrieval by structure
  not just tokens.
- **PHASE G — CognitiveCore unification**: one loop contract; SIMPLE and
  GRAPH paths become strategies; the Director generalizes into the core.
  Strangler pattern, one path per sub-phase.
- **PHASE H — Benchmark expansion**: adaptation (injected environment
  change), long-autonomy, curiosity-efficiency axes; tracked over time in
  AGI_BENCHMARK.md.

## 10. What JEXI is and is not (standing statement)

JEXI is **not AGI** and this document never claims it. JEXI is a working,
tested autonomous system with real (not decorative) instances of several
cognitive functions — planning, verification, recovery, tool selection,
memory, imagination — and honest, tested limits. The architecture above is
the path toward increasing generality, measured axis by axis by the
benchmark. Claims of capability are made only at the strength of their
citations; everything else is listed as MISSING.
