# FIXLOG B223 — Dead chrome deleted + Part 20: tool discovery registry

**Directive:** "Yeah" (to: delete the dead v1.2 chrome, or go after Part 20 — both done).

## 1. Dead v1.2 chrome deleted (8 files, zero-coupling verified first)

`TopNav, NavList, Header, BottomNavigation, ConversationsScreen, CapabilityCards,
PlaceholderPage, ActionFeed` — removed from `src/components/`.

Before deleting, the import graph was walked from the live entry (App/main) and every
candidate was path-grep-verified against server/, deploy/ and configs. The audit finding
that mattered: **most "dead" files are NOT freely deletable** —

- **Test fixtures (kept):** CommandCenter, HomeView, SettingsPanel, RichAnswer, SourceCard,
  ThinkRow, NarrationFeed are READ by six chain suites (test-b53, test-auto-mode,
  test-rich-render, test-web-search, test-thinking, test-b200) that assert on their source.
  They're dead code kept alive as regression fixtures; deleting them means rewriting those
  suites — a separate decision.
- **Parity ports (kept):** the dsh utils (gatewayClient, jexiRuntime, modelSelection,
  schemaForm, referenceSource, clientModules, agentStream, theme, web) and hooks
  (useMemory, useProjection, useSlots, usePluginInventory) are imported and TESTED by the
  dsh-batch suites — they're the B134–B150 parity port, awaiting consumers. Deleting them
  would reverse completed parity work.
- The 8 deleted files had zero importers AND zero path references anywhere.

## 2. Part 20 — objective → capability → tool discovery (the audit's row 5, DONE)

**What existed:** tools injected per-employee (composeTeam → toolsForTeam) — safe, tested,
but never discovered per-objective. B215's ObjectiveInterpreter already derived
`requiredCapabilities` from the subtasks a plan calls for; nothing consumed them for tools.

**What shipped — `server/src/services/ToolDiscovery.js` (pure, deterministic, no LLM calls):**

- **Tool → capabilities:** every registry tool (180+) derives capability tags from its type
  family + explicit hints — no tool left untagged (tested).
- **Objective → capabilities:** interpreter-derived caps (provenance INTERPRETER, synonym
  folding) + documented keyword families on the objective text (provenance INFERRED).
  `dept:*` families pass through but never count as tool gaps (they organize people).
- **Risk metadata (REAL, not invented):** B209 permission requirements from
  `Permissions.js`, registry tier (read/write_local/exec), derived flags
  (network/execute/outbound/destructive). Outbound sends keep the B56 one-approval gate —
  surfaced as `approvalRequired`.
- **Verification metadata:** how a tool's result verifies — exit-code / verdict / citations /
  state-diff / output-drain — or honestly `null` for purely generative tools.
- **The discovery pass:** required capabilities → registry matches, AutoTool-style pruned to
  ≤12 tools (never the catalog), ranked by matched count with INTERPRETER-provenance
  preference. Returns team baseline, added-for-objective delta, **honest capability gaps**
  (e.g. telephony → "no tool in the registry provides this"), and B52-allowlist withholds
  (surfaced, not silent — e.g. direct_answer never offers web-search, but research-via-memory
  is by-design allowed).
- **Wiring — additive, by design:** Director attaches
  `structuredObjective.toolDiscovery` after B215's structureObjective and emits a
  `TOOLS_DISCOVERED` event (tool count, capability count, gaps). Wrapped so discovery can
  never fail a mission. Team injection, the B52 allowlist and the B209 permission gate are
  UNTOUCHED (test asserts the Director still does no injection of its own).
- **API:** `GET /api/tools/discover?objective=…&intent=…&capabilities=a,b` — read-only,
  400 on empty objective.
- **Tests:** `test-b223.js` — 17/17, added to the chain. Registry coverage, risk truth
  (mirrors Permissions.js), verification kinds, provenance tagging, discovery cases
  (build-app → code lane not web-search; research → citations; vision), allowlist respect,
  gap honesty, team delta, determinism, wiring contracts.

**Rot fixed along the way (same lesson as B222):** the first draft's data-analysis keyword
hint matched bare "analyze" — flooding vision objectives with data tools. Hint tightened to
data-ish words only; ranking now prefers interpreter-provenance matches on ties.

## Verification
- `test-b223.js` standalone 17/17; full chain with it in-line: **EXIT=0, 0 ❌, 453s**.
- Frontend builds clean after the 8-file deletion (nothing imported them — verified by graph
  before deletion and by the vite build).
- Audit §3 row 5 → DONE; tool-system status block PARTIAL → WORKING.

## Honest limits
- Discovery is metadata today: it surfaces what an objective needs, what the team covers and
  what's missing — it does not yet FEED team composition (that would change the safe,
  tested injection seam; do it with evidence, later).
- Keyword capabilities are documented heuristics (INFERRED provenance) — the interpreter's
  subtask-derived capabilities are the authoritative lane; both are tagged so downstream
  can tell them apart.
- The 7 test-fixture dead files + parity utils remain in the tree deliberately (above).
- TOOLS_DISCOVERED is not yet rendered in the mission UI — the event + plan data are there
  for a future B216-style surface.
