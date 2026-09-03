# FIXLOG — B209: Live Supervision & The Final Gaps

**Commit:** see `git log` · **Tests:** 85 new (test-b209.js) + 13 layout audits (audit-b209-layout.js) · **Suite:** full `npm test` green · **B208 regression:** 89/89 still green

B208b's gap matrix listed 8 open gaps. B209 closes all 8 — with regression tests for every closure, and zero fake activity: every stream event still comes from actual execution.

---

## The 8 gaps, closed

### 1. Live mid-work supervision (§10 — the centerpiece)

**`server/src/services/director/Supervisor.js`** — JEXI watches the employee's token stream *while she works*:

- **Deterministic watchers, always on, every employee, zero model cost:**
  - repetition loop: a 12–40 char unit *tiled* back-to-back 3+ times in the rolling 600-char tail (a phrase merely recurring in prose does **not** fire — tested both ways)
  - degenerate character runs (`/(.)\1{40,}/`)
  - live refusal ("as an AI I can't…") — caught mid-stream, not just post-hoc
  - credential/model-identity leaks (api keys, `sk-…`, `ghp_…`, `rnd_…`) → flagged for redaction
  - runaway length (>26,000 chars)
- **One bounded LLM checkpoint review** per assignment (lead only, ~600 chars in): an injectable `review` fn (production: a cheap `generateContent` JSON verdict in RealAdapters) may redirect. It runs **once** — `reviewDone` latches; failures never block the work.
- **Redirect = stop + re-instruct + rerun, bounded:** the decision races the generation (`Promise.race` against a reject gate); the employee receives a `RECOVERY` AgentMail; the assignment restarts **once** with the redirect instruction appended (`# REDIRECTION FROM JEXI`). After `maxRedirects` (1) the supervisor goes passive — supervision itself can never loop.
- **Stall detection:** armed only *after the first token* (non-streaming providers never false-fire); 75s silence → redirect; the timer is `unref`'d.
- **Late decisions are ignored** (`finish()` disarms everything) — the Verifier remains the backstop.

Integration (`EmployeeSession.generateWithSupervision`): the `REDIRECT` error code passes through `runWithModel`'s retry wrapper **untouched** (`ModelRouter` rethrows it before provider-failure handling) and is retried at the session level, not the provider level. Every decision is evented: `SUPERVISION_FLAG`, `SUPERVISION_CHECKPOINT`, `SUPERVISION_REDIRECT`.

Employee tokens also stream to the user as `think` events (`by: <employee name>`) through the existing B173 panel — watching work is visibly alive.

### 2. The NEEDS channel (§"she can ask")

Employees may end output with `## NEEDS\nblocking: true|false\nquestion: …`:

- **Non-blocking** (an assumption): recorded on the RESULT message + a `QUESTION` AgentMail; the turn continues.
- **Blocking** (a missing fact): the task state moves `RUNNING → BLOCKED` (transition legalized), a `TASK_BLOCKED` event fires, and the turn ends by asking the user the *real* question — honestly, instead of guessing.

### 3. Runtime team management (API + UI)

- `GET /api/team/roster` — full profiles + live stats + history depth
- `POST /api/team/employees/:agentId {disabled}` — bench/activate; **staffing respects it immediately** (`rankEmployees` skips disabled employees)
- `POST /api/team/employees` — hire (upsert, normalized, capability-vocabulary-checked)
- `GET /api/team/employees/:agentId/history` — per-employee assignment history (JSONL at `data/director-history/`, wins *and* losses, newest first)
- **UI:** `TeamManager.jsx` — roster with toggles, expandable history, hire form. Added as the **TEAM** tab in AgentsScreen — and wired the whole AgentsScreen back into the app (it had been **orphaned dead code since the B192 Orbit redesign** — the drawer now has a Team destination again). RosterPanel (the 252-agent skill registry) untouched.
- **Layout audit (the B207 lesson, applied upfront):** `audit-b209-layout.js` drives a real browser at 390×844 through the drawer → Team tab → bench/activate round-trip → history expansion → hire → all three other tabs — no horizontal overflow, no clipped elements, no page errors. **13/13.**

### 4. Real permission enforcement

**`server/src/services/director/Permissions.js`** — every tool call passes a gate: `supportedTools` ∩ declared `permissions` (READ/WRITE/EXECUTE/NETWORK/GIT) against a per-tool requirement map; **DESTRUCTIVE is hard-blocked** even with every other permission. Denials emit `PERMISSION_DENIED` and the tool **never runs** (tested: the search function is provably not invoked). Artifacts are gated on `file-write`.

### 5. Artifacts on disk + FILE_CREATED

Employee artifacts (fenced blocks with filename info-strings) are persisted to `jexi-workspace/director/<taskId>/` — name-sanitized (traversal stripped, bounded), one `FILE_CREATED` event per real write (with bytes). Permission-gated. Tested: file exists, content correct, `../../../../etc/evil-plan.md` lands *inside* the task dir under a safe name.

### 6. Multi-task records per conversation

Every task is its own record (`data/director-tasks/<taskId>.json`) plus a bounded conversation index (`<convId>.index.json`, newest-first, 50 max). `loadTask(convId)` still returns the latest (compat kept); new: `loadTaskById`, `listDirectorTasks`, `GET /api/team/tasks`, and `GET /api/team/events?taskId=…` — every task replayable, not just the latest.

### 7. Event vocabulary (real subset, honestly)

Added: `TASK_CREATED` (per subtask), `MODEL_PROVIDER_FAILED` (per failed lane, with provider id), `SEARCH_STARTED`/`SEARCH_COMPLETED` (aliases alongside TOOL_*), `FILE_CREATED`, `PERMISSION_DENIED`, `TASK_BLOCKED`, `SUPERVISION_*`. Envelope: every event now carries `parentEventId` (chains to the previous event) and `providerId` where a lane is involved. Still honestly **not** emitted: `COMMAND_*`/`TEST_*` — no employee shell exists yet.

### 8. Routing signals

`Telemetry.providerMeta(provider)` → `{costClass, contextK}`; `rankProviders` breaks equal-reliability ties toward cheaper lanes (free → free-tier → freemium → paid). Reliability still beats cost (B208b rule intact).

---

## Bugs found & fixed while building

1. **Supervisor checkpoint bug** — `p_checkpoint(this)` referenced `_checkpointChars` before it was ever set; now a constructor field.
2. **Throttled watchers missed fast short streams** — a one-line refusal streamed in <1.5s would never be checked. Watchers now run on **every token** (cheap regexes over a 600-char tail).
3. **Loop detector false-positived on recurring phrases** — replaced signature-split-count with a consecutive-tiling regex (`(unit)\1{2,}`); natural prose with a recurring phrase passes, true tiling fires.
4. **AgentsScreen was dead code** — orphaned since the B192 Orbit redesign; nobody imported it. The Team feature forced the wiring fix (drawer: Chat / History / **Team** / Workshop / Settings).
5. **`RUNNING → BLOCKED` was an illegal transition** — legalized (plus `BLOCKED → PLANNING/RUNNING` for resumption).
6. Engine team reducer learned `SUPERVISION_REDIRECT` (status "correcting") and `TASK_BLOCKED`.

## Honest notes

- The redirect E2E in prod depends on an employee actually going off-track; the deterministic watchers + bounded review are verified by 85 unit/integration tests and the live UI wiring by the browser audit. Production traffic will exercise them as it happens.
- The hire form persists to `data/employees.json` (hot-reloaded); deletion is modeled as benching — identities are stable by design.

---

## Addendum (found during the live production E2E)

**The Director lane was silently declining on the live brain** — "invalid interpretation: not an object" — while the legacy graph answered fine. Root cause, reproduced against real lanes: free-tier models return *structurally complete but syntactically sloppy* JSON:

1. markdown `**bold**` inside string values (`"refinedObjective": **"Conduct…"** with rigor`) → strict `JSON.parse` fails
2. raw newlines inside string literals ("Bad control character in string literal")

The strict `extractJson` returned null → the Director declined the turn → the legacy pipeline took over. It looked like "working fallback" while quietly disabling the boss on exactly the lanes free tiers serve.

**Fix (both directions):**
- **`JsonRepair.js`** — a conservative repair parser: strict first, then markdown-emphasis strip, string-literal control-char escaping, trailing-comma removal, stray-value-tail merging, and truncated-tail balancing/dropping (a truncated last element is dropped, never half-invented). Non-JSON garbage still returns null — the honesty path is intact. Used by both the interpreter (`RealAdapters`) and the Verifier (a sloppy-but-complete rubric no longer reads as "no verdict").
- **Interpret lane-retry** — a lane that answers *without any* JSON is retried on alternates before the Director declines.

Tests: section 14 (7 checks, both real production failure shapes verbatim). **92/92.**
