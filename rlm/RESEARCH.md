# Phase 10 source research

Source: https://github.com/PrimeIntellect-ai/prime-agent
Pinned revision: `e311d6495124cf0bdc629c813fc97a39a9a3054d`.
Read source locally before implementation; no upstream code copied.
Paths below are relative to that repository, not JEXI.

| Pattern | Source inspected | JEXI implementation decision |
| --- | --- | --- |
| Persistent runtime | `prime-agent-runtime/src/rlm/repl.py`, `repl.md`; `packages/coding-agent/src/core/kernel/repl-manager.ts` | Current Prime is CPython, persistent namespace, ordered NDJSON requests, cell-attributed output; not current IPython. A uses a Node VM lexical context, explicit output/error envelope. |
| Context and programmatic delegation | `prime-agent-runtime/src/rlm/__init__.py`, `harness.py`; `packages/coding-agent/src/core/prompts/rlm.ts` | Separate prompt/data slots from execution. Spawn returns a child handle, not a fabricated answer; host-owned delegation belongs in subsequent scopes. |
| Harness CRUD and base | `prime-agent-runtime/src/rlm/harness.py`; `packages/coding-agent/src/core/refinement/refinement.ts:130–178` | Four mutable artifact categories, supplemental prompts only; immutable base must be enforced in code, not merely a planner instruction. B implementation pending. |
| Refine | `packages/coding-agent/src/core/refinement/refinement.ts` (planner, apply, rollback); `packages/coding-agent/skills/refine/SKILL.md` | Small evidence-backed edits, no mid-cell mutation, prior-state rollback. JEXI C will require explicit evidence and snapshot-before-write. |
| Daemon topology | `packages/coding-agent/src/modes/daemon/daemon-supervisor.ts`, `worker-recovery-journal.ts`; `src/core/kernel/repl-manager.ts` | Discovery/routing outside session workers; kernel below worker. D will use `rlm/daemon/`, never modify out-of-zone `kernel/`. |
| Session DAG | `packages/coding-agent/src/core/session-manager.ts` (`parentId`, append, branch traversal) | Append records, reconstruct from parent edges; E must prove independent branch/clone and lossless compaction. |
| Family messaging | `packages/coding-agent/src/core/agent-messages.ts` (`agentFamilyRelationship`, `assertAgentFamilyReach`) | Parent/child/shared-parent sibling edges only. Do not mistake common ancestor for authorization. F pending. |
| Autonomous execution | `packages/coding-agent/src/core/autonomous.ts` | Explicit turn/token/time accounting and gate failures block completion. JEXI G must report exact stop reason. |
| Runtime snapshots | `packages/coding-agent/src/core/kernel/state-snapshot.ts` | Prime uses best-effort per-variable dill, reports skipped resources. Node has no equivalent general heap serializer. A explicitly supports deterministic synchronous replay snapshots; do not call these arbitrary heap checkpoints. |

Scope A has no daemon, durable session journal, provider call, subagent spawn,
async scheduling or server registration. Those are not claimed as implemented.
The retention requirement of 30 minutes comes from the JEXI task; this research
has not established that exact default in the pinned Prime revision.
