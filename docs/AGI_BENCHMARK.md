# AGI Benchmark — results over time

Scores are 0–1 per axis; overall is the mean. Run `node tests/agi/benchmark.js --record` (from `server/`) after every phase.

| Date | generalization | planning | calibration | transfer | epistemic | robustness | Overall |
|---|---|---|---|---|---|---|---|
| 2026-09-05 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | **1.000** |

## What this measures — and what it does NOT

**Measures (deterministically, keylessly, against real subsystems):**

- **generalization** — an *unseen, invented* domain (orbital hydroponics scheduling) is structured by the ObjectiveInterpreter and discovered by ToolDiscovery with **no fabricated tools** (every result is a real registry tool) and honest gap reporting.
- **planning** — WorkGraph ready-work is deterministic (priority desc, createdAt asc), blocked work is never offered, leases are exclusive, completing a blocker releases dependents, `dependencyWaves` never schedules a task before its dependencies, budgets are enforced counters.
- **calibration** — the Verifier's deterministic gates on labeled fixtures: empty/refusal/substitute/too-short deliverables FAIL, real work PASSES; a browser-method claim with zero browser events is detectable fabrication; zero execution events render as zero, never padded.
- **transfer** — a lesson recorded from a *python flask* deploy failure is retrieved for a *node api* deploy query and renders into plan context with its provenance (what failed, why, the strategy).
- **epistemic** — an impossible capability (`telepathy`) is reported as a gap with the true reason, no tool pretends to provide it; the world model records `browser.available=false` *with the reason*; an underdetermined objective is structured without invented user requirements.
- **robustness** — WorkGraph and Mission state survive reload exactly (items, relations, budgets); resume is precise (completed work is not re-offered); illegal state transitions are rejected.

**Does NOT measure (yet — expand per Phase H):**

- Real-LLM planning quality on novel goals (needs keys; out of scope for CI).
- Long-horizon autonomy in production (covered separately by `tests/autonomy/*`).
- Curiosity/information-gain, procedure abstraction, global world model — these capabilities do not exist yet; the benchmark will grow axes as each Phase B–G lands.
- Any claim of general intelligence. **A perfect score here means the deterministic machinery behaves correctly on these fixtures — nothing more.**

The overall threshold gates the CI chain at **0.90**: a regression in any axis can drop the mean only so far before the chain fails.

## Method

Pure Node script (`server/tests/agi/benchmark.js`), no API keys, no network, isolated `DATA_DIR` (`data/test-agi-bench`, removed before each run). Every check drives the real exported subsystems — ObjectiveInterpreter, ToolDiscovery, ToolRegistry, WorkGraph, Mission, Verifier, Lessons, WorldState, Director — with scripted inputs. Assertions are deterministic; the harness fails if any axis throws.
