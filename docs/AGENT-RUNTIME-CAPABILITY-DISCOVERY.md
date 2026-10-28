# AGENT RUNTIME — CAPABILITY DISCOVERY AND RELIABILITY

Date: 2026-10-27 · Status: SHIPPED (wired end-to-end, 12/12 evaluation tasks green)

## 1. The defect

JEXI refused work it could actually do. Measured, before the fix:

| Request | Classified intent | Tools offered | Capability the request needed |
|---|---|---|---|
| "search the web for the latest Node.js release" | `legal_task` | 2 (`compliance-check`, `privacy-review`) | `web_search` — **not offered** |
| "read the file package.json" | `learning_research` | 32 | `fs_read` — **not offered** |
| "run ls -la in the terminal" | `learning_research` | 36 | `term_execute` — **not offered** |
| "fix the failing test" | `learning_research` | 32 | `testing`, `filesystem_write` — **not offered** |

In each case the capability existed, was registered, and had a working engine.
Naming the tool explicitly made it work, which is the tell: the execution layer
was fine and the **discovery** layer was broken.

This is the failure mode the mission names: JEXI claimed a capability was
unavailable while being able to use it. It was not a prompt problem. Three
structural causes, all in the runtime:

### Cause 1 — discovery was gated by an intent classifier

`Planner._classify` maps a request to one of a fixed set of intents by keyword,
and `plan.tools` is then derived from the resolved agent team
(`toolsForTeam`). The offered tool set was therefore a function of the
*classification*, not of the *request*. A misroute silently removed the tools
the request plainly asked for. `run ls -la in the terminal` classified as
`learning_research` and was offered 36 tools with no terminal among them.

### Cause 2 — a skill allowlist that could not be enforced

The shipped `debugging` skill declares
`allowedTools: ["read","edit","terminal.execute","testing.run"]`. None of those
are real tool slugs (`fs_read`, `fs_edit`, `term_execute`, `pytest_run` are).
The builder intersected the offered set against that list, which reduced a
coding turn to almost nothing — measured: `fs_read` and `pytest_run` dropped
from a turn whose whole purpose was to run pytest. The intersection looked like
policy and behaved like a bug.

### Cause 3 — availability was a promise, not evidence

"JEXI can search the web" was backed by the tool existing in a catalogue. No
distinction was made between a tool that is *registered*, one that is
*available* under the active permission profile, and one that has *actually
succeeded*. That conflation is what made an optimistic claim possible — and a
false claim in the other direction, refusing work it could do, is the same bug
seen from the other side.

### Cause 4 — a safe tool reported unavailable (found while fixing Cause 3)

The two tool registries disagree on the definition shape.
`resolveToolDef` (the `services` registry) returns **`null`** for a domain tool
such as `fs_read` and then falls back to a probe stub of the form
`{ slug, name, desc, permission }` — **with no `riskLevel`**. Reading
`def.riskLevel ?? 'medium'` therefore mapped every domain tool to the `medium`
tier, and the `readonly` profile (which permits `['safe']` only) reported
`filesystem_read` — a tool that declares `riskLevel: 'low'` — as
`permission_denied`. A read-only session could not read.

This was found by probing the runtime rather than by reading it: the capability
block, generated under `readonly`, listed `filesystem_read` as unavailable. It
is the same defect class as the mission's original complaint, in the opposite
direction, and it is why the fix reads the risk level from the definition the
domain executor actually gates on (`tools/registry/ToolRegistry.js`) instead of
defaulting.

## 2. The architecture

Five parts. The first three fix discovery; the last two make the model's
statements about itself checkable.

### 2.1 Four-state capability model — `src/capability/registry/registry.js`

A capability is never "available" as an assertion. Its state is derived:

| State | Meaning | Derived from |
|---|---|---|
| `exists` | The catalogue knows it | catalog entry present |
| `registered` | A tool/MCP provider is registered | tool registry lookup |
| `available` | Usable **now** | engine present + permitted by the active profile + MCP server healthy |
| `succeeded` | Proven this session | a real, non-refused success in the evidence ledger |

`describeCapability(id, { profile })` returns the state plus the reason it is
not higher. A capability denied by the profile reports
`available: false, reason: 'permission_denied'` while still reporting
`registered: true` — because "registered" is true and "available" is not, and
saying so is the whole point.

### 2.2 Requirement inference — `src/capability/registry/requirements.js`

Decouples *what the request needs* from *what the classifier said*. Rules read
the request's own words and the plan's intent:

- "search the web" → `web_search`; "run … in the terminal" → `terminal`;
  "read the file" → `filesystem_read`
- intent `code` → `filesystem_read` + `filesystem_write` + `testing` + `terminal`
  (a coding turn needs read + edit + verify even when it does not say so)

Each requirement carries the `why` that fired it, and requirements are marked
`explicit` (from the request's words) or an intent default. That distinction is
load-bearing downstream: an explicit requirement outranks the coding tool cap
and a skill's allowlist; an intent default does not.

### 2.3 Capability-driven selection — `src/capability/registry/selection.js`

`selectCapabilityTools({ query, plan, profile })` infers requirements, verifies
each against the live registry, and returns the slugs to add. Two deliberate
properties:

- **Verified, not assumed.** A slug is only offered if it resolves *and* has an
  engine. The model is never handed a tool that will fail on call.
- **Minimal by default.** One provider satisfies a capability. Offering every
  provider is how "read a file" ends up holding `fs_delete` — a high-risk tool
  nobody asked for. `expandAll` exists for callers that want the full set.

### 2.4 Evidence ledger — `src/capability/registry/ledger.js`

`recordOutcome({ tool, result })` classifies every real call into
`succeeded` / `refused` / `failed` and lifts the capability's state only on a
genuine success. Two distinctions the runtime previously did not make:

- A transport-ok result with a failing **verdict** is a failure. A red test
  suite is not a success because the process exited cleanly.
- A **refusal** (permission denied, blocked) is not a failure. The capability
  was not exercised; it was not permitted.

Wired into the live loop at `AgentLoop.js` immediately after `executeTool`, so
the ledger is populated by real turns, not by tests.

### 2.5 Prompt-side guidance — `src/services/CapabilityPrompt.js`

The system prompt now carries a block generated from the registry: what is
available (with when-to-use), what is **not** available and must not be claimed
(with why), and what has already worked this session. Generated, never written
once — a static capability list drifts from the runtime, which is how the
original defect survived.

### 2.6 Self-inspection — `capability_check` tool

A safe, read-only tool in the control plane (always reachable, whatever the plan
says). Two modes:

- `capability_check({ forTask })` → which capabilities this task requires and
  whether each is available; `canProceed` is false when one is not.
- `capability_check({ capability })` → the four-state detail plus session evidence.

The model can now answer "can you do this?" from the runtime instead of from
memory. A check under `readonly` reports `filesystem_write` as
`registered / permission_denied`, not `available` — a false positive here would
reproduce the very bug this work fixes.

## 3. What changed

| File | Change |
|---|---|
| `src/capability/registry/{catalog,registry,ledger,requirements,selection,index}.js` | new — the capability registry |
| `src/services/agent/ToolSetBuilder.js` | merge required capabilities after the plan; rescue explicit requirements from the coding cap; refuse to narrow by an unenforceable allowlist; expose the report |
| `src/services/AgentLoop.js` | record real outcomes in the ledger; publish `requiredCapabilities` / `unavailableCapabilities` on the plan event |
| `src/services/PromptAssembly.js` | inject the generated capability block |
| `src/services/CapabilityPrompt.js` | new — the generated block |
| `src/tools/domains/capability/index.js` | new — `capability_check` |
| `src/tools/domains/index.js` | register the capability domain |

## 4. Evaluation

Thirteen scenarios in `evaluation/capability-tasks.js`, run by the existing
harness (`node evaluation/run.js`). They cover the mission's five measurements —
task completion, tool selection, execution success, verification quality,
false-success claims — as executable checks against real subsystems. Keyless and
deterministic.

Result: **73/73, overall 1.000** (gate 0.90).

### The checks were mutation-tested

A test that passes before and after a fix proves nothing. Two mutations were
applied to confirm the checks actually catch the defect:

| Mutation | Caught by |
|---|---|
| Disable the capability merge (pre-fix behaviour) | C1, C2, C3, C5 — overall fell to 0.952 |
| Restore narrowing by the raw allowlist (Cause 2) | C5, C6 — overall fell to 0.976 |
| Restore the naive `riskLevel ?? 'medium'` default (Cause 4) | C13 — plus `registry: a SAFE read is still available under readonly` |

All three restored; the tree is clean and the suite is back to 1.000.

## 5. Honest limits

- **Terminal execution is degraded in this container.** `term_execute` fails with
  `unshare: write failed /proc/self/uid_map: Operation not permitted` — the
  namespace sandbox cannot be set up. The engine reports the real stderr and
  marks the sandbox `degraded` rather than faking success; C3 asserts that
  honesty rather than assuming the command runs.
- **Requirement inference is rule-based.** It reads the request's words. It will
  not infer a capability that is needed but neither stated nor implied by the
  intent — an LLM-driven inference would, at the cost of determinism.
- **The `debugging` skill's allowlist is still wrong.** The builder now refuses
  to narrow by an unenforceable list and logs a warning, so the turn is no longer
  starved; the skill file itself has not been corrected. Fixing the data is the
  right follow-up.
- **Ledger state is per-process.** It answers "has this worked in this session",
  which is what the prompt needs; it is not durable across restarts.

## 6. Relation to Harness²

The mission asked for research into Google's Harness²
(`github.com/google-research/harness2`, arXiv 2610.14224). Verified live on
2026-10-27: repo HTTP 200, paper abstract retrieved from
`export.arxiv.org/abs/2610.14224`, submitted 9 Oct 2026.

Harness² argues that an agent's capability depends on its *harness* — the
execution scaffolding around the model — and that harnesses can be improved
recursively. Its task-level recursion uses a **contrastive Propose-Probe-Compose**
step to guide edits **without ground-truth verifiers**: the harness proposes a
change, probes it, and composes what worked, using contrast between attempts
where no oracle exists.

That is the principle this work applies. JEXI had no oracle saying "the tool set
was wrong for this request" — the classification looked successful. The fix
makes the runtime **probe its own capability set** (infer requirements, verify
each against the live registry) and **contrast** the result with what was
offered, rather than trusting the classifier. Where Harness² applies this to
harness edits across tasks, JEXI applies it within a turn to capability
selection, which is the same contrastive move at a smaller granularity.

The 12 evaluation scenarios are the harness-level counterpart: a deterministic
suite that detects a capability regression without needing a model in the loop.

Sources:
- Repo: https://github.com/google-research/harness2 (HTTP 200, 2026-10-27)
- Paper: https://arxiv.org/abs/2610.14224 — "Harness^2: Recursive Agent Harnessing
  for an Open World", submitted 9 Oct 2026.
