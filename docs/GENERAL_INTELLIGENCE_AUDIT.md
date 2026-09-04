# JEXI OS — GENERAL INTELLIGENCE AUDIT (B224)

> Part 56 of the master spec. This is an ENGINEERING audit of the system's
> intelligence dimensions, answered against the shipped, tested code — the
> same discipline as CAPABILITY_MATRIX.md: **REAL** means implemented,
> wired end-to-end, and covered by passing tests. Nothing here claims the
> system is sentient, or "has" general intelligence. It audits what the
> machinery can and cannot do, with the tests that prove each claim.
>
> Verification snapshot: full chain green (B224, 0 ❌); local + CI.

## The dimensions

### 1. Objective understanding — REAL, bounded
The Director's interpret pass refines every raw message into a structured
objective (B215): constraints, success criteria, assumptions, unknowns — each
provenance-tagged (USER_STATED / INFERRED / ASSUMED / UNKNOWN) so downstream
can always tell the user's words from the interpreter's reconstruction.
Unknowns are never fabricated; an empty unknowns lane is an honest empty list.
**Limit:** understanding is one interpret pass, not an iterative dialogue —
high-ambiguity + risky objectives BLOCK and ask rather than guess (tested,
B211b2). Refinement quality is bounded by the model lane (free-tier physics:
Groq TPD, provider cooldowns — B219/B220 made the lanes honest about this).

### 2. Planning — REAL, deterministic where it can be
Persistent work graphs with typed relations (BLOCKS / DISCOVERED_FROM /
SUPERSEDES / PRODUCES), deterministic ready-work ordering (priority desc →
createdAt asc), leases, atomic persistence, restart recovery
(`test-b211.js` A; `tests/autonomy/backend-restart.js` with a REAL SIGKILL).
Discovered work is classified and lineaged (EXECUTE_NOW / QUEUE / DELEGATE /
DEFER / IGNORE_WITH_REASON). Steering invalidates only affected items — done
work is never redone.
**Limit:** impact analysis is LLM-driven; when that lane is down, steering
defers honestly instead of guessing.

### 3. Memory — REAL, multi-layer
Memory core (facts, preferences, learned answers), rolling summaries,
episodes, semantic search (hybrid vector + keyword), knowledge library,
per-project progressive knowledge folders, session transcripts mirrored to
Redis and rehydrated on boot (B217 — transcripts survive deploys now).
`test-memory-*.js`, `test-b217.js`.
**Limit:** recall is token-relevance retrieval, not infinite context; the
rolling summary is the long-conversation compression layer.

### 4. Tool use — REAL, permissioned, and now DISCOVERED (B223)
~180-tool registry with engines, agents, tiers. The B209 permission gate
enforces READ/WRITE/EXECUTE/NETWORK/GIT/DESTRUCTIVE per employee; destructive
tools hard-block without explicit profile permission. CommandRunner is a real
allowlisted executor with real exit codes. B223 added the Part 20 discovery
pass: objective → required capabilities (interpreter + documented keyword
families, provenance-tagged) → registry-matched tools with risk and
verification metadata, honest capability gaps, B52 intent-allowlist respect —
additive metadata over the safe per-team injection (`test-b223.js` 17/17).
**Limit:** discovery informs; it does not yet compose teams (deliberate —
change the safe seam with evidence, not enthusiasm).

### 5. Verification / anti-fabrication — REAL, deterministic floor
ACTION COMPLETED vs OBJECTIVE VERIFIED are distinct states; deterministic
acceptance gates (empty/short/refusal/fabricated-execution) run WITHOUT any
model (`test-b210.js` 64 checks). Fact-check and self-consistency loops audit
answers against sources. Artifacts are content-hashed; a claim about a file
requires the file.
**Limit:** verification of open-ended quality ("is this essay good?") is
model-judged, not deterministic — the system says so in the verdict provenance.

### 6. Learning from failure — REAL
Lessons (failure → cause → strategy) persist cross-process, dedupe, cap at
300, and reach the NEXT plan prompt (`test-b211b2.js` E/K; failure-injection
suite). PREDICTED vs ACTUAL deviations produce a lesson at mission end.
**Limit:** lesson retrieval is token-relevance; no reinforcement-style
weight updates.

### 7. Autonomy / recovery — REAL, layered
Model-lane fallback (9-rung, telemetry-informed; employee identity never
changes with the model), assignment ladder (RETRY/REASSIGN/ESCALATE), replan,
restart recovery (DONE never redone), browser-disconnect safety (the chat is
a view; work is server-side), chaos/failure-injection suites prove each layer.
**Limit:** single-employee staffing cannot REASSIGN (honest: RETRY→ESCALATE).

### 8. Event truth / observability — REAL, now PUSHED (B224)
Every operational fact is a server-originated event with a chained id,
append-only persisted per mission, replayable after reconnect. The frontend
invents nothing — it renders. B224 closed Part 29: SSE push for mission
events (native Last-Event-ID replay, bounded 300, heartbeat, ?key= auth for
EventSource; REST polling remains the fallback and stretches while push is
live) — `test-b224.js` 10/10, wire-tested on a real HTTP server.

### 9. Perception — REAL where hardware allows
Vision (describe/OCR/solve, model-lane), audio transcription, real browser
observation loops (observe → act → observe → verify, `test-b211b3.js` F),
desktop screenshots that are real captures or absent.
**Limit:** no local microphone/camera daemon; production browser runs only in
the deploy image that has Chromium.

### 10. Honesty about itself — REAL (this document is part of it)
SIMULATION_UNAVAILABLE is recorded with the real reason, never faked
(`test-b211b2.js` C/H). Dead models are pruned, not dialed (B219). Provider
cooldowns honor the provider's own retry-after (B220). AndroidRuntime does
not exist and is not claimed (Part 13, honestly blocked). The status
vocabulary (SHIPPED/PARTIAL/NOT BUILT) is enforced by the matrix rule:
nothing is SHIPPED on code existence alone.

## The honest overall statement

JEXI OS is an autonomous mission engine with real tooling, real memory, real
verification floors, and real recovery — its "intelligence" is the discipline
of the machinery around the model lanes, not the models themselves. What it
does NOT have: iterative dialogue-based understanding, reinforcement
learning, unbounded context, or general-world common sense beyond what its
tools observe. Every one of those absences is documented above with the
specific limit, and the tests cited for everything that IS there.
