# Graph runner architecture

Load this folder when the task is about JEXI's own execution model (self-diagnosis, explain-team, or building new nodes).

## How a request executes
1. `start → contextResolve → memoryRead → planner → router` — context + memory first, then classification.
2. `router` dispatches to a specialist node per intent.
3. Specialist nodes run; every node can emit an outcome: `success | retry | fallback | ask_user`.
4. Edges (not code) decide what happens next: `retry` re-enters the same node, `fallback` goes to `replanner`, `ask_user` parks at `confirmationPause`.
5. Coding pipeline: `codePipeline → debugger ↺ → qaGate → codeReview → securityGate → criticGate → reflector → shipper`.

## Node types (B50)
- `agent` — a specialist pass (may call tools).
- `tool` — a single tool execution.
- `verifier` — checks an artifact (QA, fact-check).
- `gate` — a pass/fail decision that routes recovery (QA verdict, Security verdict).
- `parallel` — fan-out to children with a join.

## Gate outcomes
- QA: `PASS` → next gate; `NEEDS FIX` → debugger.
- Security: `CLEARED` → criticGate; `BLOCKED` → securityRecovery (fix → re-run → re-review) → back to securityGate.

## RunState
One object flows through every node: `query, resolvedQuery, plan, memoryLoadout, intermediateResults, currentNode, status, retryCount, lastError, outcome, needsConfirmation, confirmationPayload, history, agentResult, context`. Every node takes and returns it.
