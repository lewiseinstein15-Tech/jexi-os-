# Orca Study — what JEXI adopts, what it rejects, and why

**Date:** Sept 6, 2026 · **For:** Ultimate Architecture Upgrade (ExecutionBackend §38)
**Sources actually inspected (not README-only):**
- `stablyai/orca` repo landing + README structure (62.4k stars, very active — 10k+ commits)
- `skills/orca-cli/SKILL.md` (discovery stub, fetched raw)
- `skill-guides/orca-cli.md` (worktrees, terminals, full handoffs — fetched raw)
- `skill-guides/orchestration.md` (Runs, Tasks, Dispatches, message types, DAGs, gates — fetched raw, chunks 0–1 of 6)
- NOT inspected in depth: the TypeScript/Electron app source itself (10k+ commits; the agent-facing contract docs above are the part that matters for this study)

**Standing rule honored:** study, never copy. JEXI does not become Orca.

---

## What Orca is

Orca is an "ADE" — an Agent Development Environment. It runs a **fleet of parallel
coding agents** (Codex, Claude Code, Gemini, Grok, …) on a user's own desktop,
each in its own **git worktree** (isolated repo checkout) and **managed terminal
(PTY)**. A coordinator agent supervises workers through a structured
orchestration layer: Runs, Tasks, Dispatches, and typed messages
(`worker_done`, `heartbeat`, `ask`, `escalation`, `decision_gate`).

## Orca's core concepts

| Orca concept | What it means in Orca | JEXI decision |
|---|---|---|
| **Run** | Durable namespace + coordinator inbox; never schedules anything itself | **ADOPTED (simplified)** — JEXI `TaskGraph` runs are durable records with a timeline; the graph itself schedules |
| **Task + Dispatch** | Task = tracked unit; Dispatch = lifecycle authority (which coordinator owns the worker right now) | **ADOPTED (merged)** — JEXI tasks carry agent/tools/dependsOn + the 11 lifecycle states; no separate dispatch layer (JEXI has exactly one boss: JEXI) |
| **Worker lifecycle** | spawn → preamble-injected → heartbeat/alive → `worker_done`/`escalation` | **ADOPTED** — CREATED→QUEUED→STARTING→READY→RUNNING→WAITING→COMPLETED (+FAILED/TIMEOUT/CANCELLED/BLOCKED); "alive ≠ done" rule adopted too (heartbeats don't complete a task) |
| **Task DAGs + decision gates** | dependency-aware dispatch, coordinator asks before proceeding | **ADOPTED** — `dependsOn` + parallel execution + `WAITING` state (a worker can pause for input like Orca's blocking `ask`) |
| **Retries / waits / timeouts** | `check --wait` rolling waits, at-least-once delivery, resume by message id | **ADOPTED (in-process)** — per-task retries with backoff, per-task timeouts, run cancellation; no durable message queue (in-process graph doesn't need one) |
| **Provenance honesty** | "Before claiming a worker was orchestrated, verify the task/dispatch exists. If work ran outside orchestration, say so plainly." | **ADOPTED** — matches JEXI's standing honesty rules; timeline events are the proof of what actually ran |
| **Full handoff vs supervised orchestration** | explicit distinction: ownership transfer ≠ supervised dispatch | **ADOPTED (concept)** — JEXI's subagents are always supervised (JEXI is the boss); full-handoff doesn't exist in JEXI's model |
| **Worktree-per-task isolation** | every task gets its own git worktree + terminal | **REJECTED** — Orca is a desktop fleet with user subscriptions; JEXI is a hosted executive agent on a 512MB free brain. Worktrees × agents × PTYs is heavyweight isolation JEXI's scale doesn't need — JEXI subagents already run through the gated tool runtime with permission profiles |
| **PTY terminal process model** | agents are TUIs in managed pseudo-terminals | **REJECTED** — Lewis's standing rule: no local model/agent hosting; JEXI uses remote LLM providers only |
| **CLI-as-RPC to a desktop runtime** | orchestration commands are RPC calls to the running Orca app | **REJECTED** — JEXI's TaskGraph is in-process by design; one less moving part, nothing to install or keep alive on a free host |
| **Legacy contract machinery** | authority labels, replay fencing, adoption/takeover protocols | **REJECTED (for now)** — solves multi-coordinator upgrade races JEXI doesn't have; JEXI owns its whole stack. Worth revisiting ONLY if external coordinators ever attach |
| **Embedded browser control** | browser tabs inside the Orca app | **NOTED** — JEXI's browser story lives in docs/BROWSER-PLAN.md; unrelated to this upgrade |

## The ExecutionBackend verdict (§38)

- **JexiNativeBackend — BUILT and shipped.** A TaskGraph task runs through the
  existing WorkerRouter + gated tool runtime. Nothing working was rewritten.
- **OrcaBackend — DESIGNED, NOT BUILT (honest).** The interface exists
  (`registerBackend({ id: 'orca', execute })`); no code, no dependency, no
  install. Justification for the abstraction: if JEXI ever runs on hardware
  that hosts an Orca fleet (e.g. Lewis's own machine, per BROWSER-PLAN's
  "full image on any 2GB machine" path), the graph could dispatch tasks to
  Orca workers without touching the graph itself. Until that day, "designed"
  is the truthful status — JEXI works fully without Orca, and the spec's rule
  ("no unnecessary dependencies") is honored: zero npm packages added.

## One-line summary

Orca proves the RUN/TASK/WORKER/DAG model at desktop scale; JEXI adopts its
lifecycle, DAG, retry and provenance discipline in-process, rejects its
worktree/PTY/CLI machinery as heavyweight for a hosted free-tier executive
agent, and keeps the Orca door open through a one-function backend seam that
is designed but deliberately unbuilt.
