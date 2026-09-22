# FIXLOG-B50 — Claude-Code Primitive Gaps (Implementation Directive)

Every Priority: before/after evidence + exact `npm test` command and result.
Worked top to bottom. B49 work was not re-done; built on top of it.

---

## Priority 7 — Lean system prompt (procedural content moved out) ✅ DONE

### Before
- `JEXI_SYSTEM_PROMPT` (JexiPrompt.js) was 12,429 chars: identity + rules PLUS
  large procedural blocks — ANSWER REFRAMING METHOD (5 steps), FORMATTING
  RULES, MATHEMATICS structure (GIVEN/FORMULA/WORKING/FINAL), PROGRAMMING
  structure, OUTPUT FORMAT BY INTENT (per-intent templates), RESEARCH & LINK
  ANALYSIS, and the TOOL USAGE decision table.

### After
- All procedural blocks moved to a new progressive knowledge folder:
  ```
  server/knowledge/formatting/KNOWLEDGE.md
  ```
  (answer-reframing method, formatting rules, LaTeX math layout, code-answer
  structure, per-intent output templates, link analysis, tool-usage table).
- `JexiPrompt.js` now carries ONLY: identity, CORE PRINCIPLES (7 non-negotiable
  rules), SOURCES & HONESTY rules, CONVERSATION rules, a short KNOWLEDGE &
  TOOLS summary (pointing at knowledge-load categories), VOICE_RULES, and the
  always-on PROJECT KNOWLEDGE (JEXI.md).
- `server/knowledge/JEXI.md` gained the `formatting` pointer.
- `test-audit-b47.js` updated: asserts the prompt now points at the formatting
  folder instead of embedding per-intent templates.

### Evidence (token impact)
```
$ node --input-type=module -e "import {JEXI_SYSTEM_PROMPT} …"
prompt chars: 7889 (before: 12429)   ← 36% leaner, prompt did NOT grow
keeps identity: true
keeps rules: true (VERIFY BEFORE SUCCESS, NEVER invent sources)
procedural moved out — math template gone: true
procedural moved out — per-intent gone: true
points at formatting folder: true
$ node test-knowledge-base.js   (now 18 checks incl. P7 lean-prompt proofs)
=== RESULT: 18 passed, 0 failed ===
$ cd server && npm test
exit=0 · 986 ✅ · 0 ❌
```

---

## Priority 6 — GraphRunner: typed nodes, outcomes, parallel join, recovery ✅ DONE

### Before
- GraphRunner (143 lines) supported only plain function nodes + edge
  resolvers. No node types, no outcome-driven routing (success/retry/fallback),
  no parallel fan-out/join — independent gates and recovery paths were
  hand-rolled in the Orchestrator instead of being graph primitives.

### After
- **Typed nodes**: `{ type: 'agent'|'tool'|'verifier'|'gate', run, retries,
  fallback }`. Types surface in `state.nodeTypes`. Plain fns remain valid
  (treated as 'agent') — fully backward-compatible with the Orchestrator.
- **Outcomes**: a node sets `state.outcome = 'retry'` → auto re-runs the SAME
  node bounded by `retries`; `'fallback'` → routes to `node.fallback` (then
  the edge); otherwise the edge resolver runs.
- **Conditioned edges**: `when({ success, retry, fallback, default })` builder
  branches on the node's outcome.
- **Parallel fan-out + join**: `runParallel({ fns, state, join })` runs node
  fns concurrently (each writes `intermediateResults[name]`) and joins.
- **Thrown nodes** still become structured `NODE_THREW` failures routed via
  fallback/edge — never a silent end.

### Evidence — concrete high-stakes gate with a recovery path
```
$ node test-graph-runner.js
✅ typed nodes recorded (agent/tool/verifier/gate)
✅ retry outcome re-runs the node (3 runs)
✅ gate failed twice then passed (3 gate runs)
✅ failure path routed to the recovery node (2 recoveries)
✅ recovery path is visible in history: qa-gate>recover-fix>qa-gate>recover-fix>qa-gate
✅ gate produced a success outcome at the end
✅ parallel fan-out joined all 3 results
✅ thrown node is caught and routed
=== RESULT: 11 passed, 0 failed ===
$ cd server && npm test
exit=0 · 978 ✅ · 0 ❌
```

The gate graph definition itself (from the suite):
```js
const g = createGraph({
  start: 'qa-gate',
  nodes: {
    'qa-gate': { type: 'gate', run: …, fallback: 'recover-fix' },
    'recover-fix': { type: 'agent', run: … },
  },
  edges: {
    'recover-fix': when({ success: 'qa-gate' }), // loop back through the gate
    'qa-gate': when({ success: 'end', fallback: 'recover-fix' }),
  },
});
```

---

## Priority 5 — Installable plugin packages ✅ DONE

### Before
- PluginRegistry had a hard-coded `PLUGINS` array (6 built-ins) with runtime
  toggle + persisted state, but NO on-disk package format — nothing versioned,
  shareable, or droppable into a directory.

### After
- **Package format** (documented in `server/plugins/README.md`):
  ```
  server/plugins/<plugin-name>/
    plugin.json   # id, name, version, description, contributes
    skills/       # skill folders this plugin provides
    agents/       # optional agent definitions
  ```
- **`server/plugins/coding-pipeline/`** — the first real package: the 7 core
  pipeline skill folders from Priority 1 were MOVED into
  `server/plugins/coding-pipeline/skills/` (product, engineer, coder, qa,
  reviewer, security-officer, reflector), per the directive.
- **SkillChain** now resolves plugin skills: `skillFolder()` checks
  `server/skills/<slug>` first, then every discovered plugin's `skillsDir`.
- **PluginRegistry** discovers on-disk packages: `discoverPlugins()` scans
  `server/plugins/*/plugin.json`; `ALL_PLUGINS` = built-ins + discovered;
  `listPlugins()` surfaces each package's contributions incl. a new
  `live.packagedSkills` count; enable/disable/toggle work for discovered
  plugins exactly like built-ins.

### Evidence
```
$ node --input-type=module -e "import {listPlugins,…} …"
discovered coding-pipeline: true | builtin: false | packagedSkills: 7
toggle works for discovered plugin: true
total catalog: 7
$ node test-plugins.js
✅ on-disk coding-pipeline plugin discovered
✅ full catalog includes discovered plugin (7 total)
✅ coding-pipeline reports 7 packaged skills
✅ coding-pipeline contributes the pipeline skills
✅ discovered plugin can be enabled … disabled
=== RESULT: 18 passed, 0 failed ===
$ cd server && npm test
exit=0 · 967 ✅ · 0 ❌
```
- SkillChain resolves all 7 pipeline skills from the plugin (progressive
  loading intact — P1 tests still green).

---

## Priority 4 — Subagent isolation + reusable agent definitions ✅ DONE

### Before
- `SubagentRuntime` could spawn parallel AgentLoops and aggregate, but every
  subagent's FULL answer flowed into the parent result and the aggregation
  prompt — no isolation pattern, and no on-disk reusable agent definitions.

### After
- **Reusable agent definition files** (`server/agents/`):
  ```
  server/agents/researcher.md        (name, description, model, allowed-tools, context: fork)
  server/agents/security-auditor.md
  server/agents/code-reviewer.md
  ```
  Each has YAML frontmatter + a real specialist system-prompt body.
- **`server/src/services/AgentDefinitions.js`** — loader:
  `listAgentDefinitions()`, `loadAgentDefinition(slug)` (→ {slug, meta,
  systemPrompt}), `wantsIsolation(def)` (frontmatter `context: fork`),
  `allowedToolsFor(def)`.
- **Isolation in SubagentRuntime**: a task with `context: 'fork'` (or whose
  agentDef / skill frontmatter declares fork) runs via `runIsolatedSubagent`:
  its own context window; the parent receives ONLY {name, status (PASS/FAIL),
  summary (≤ ~350 chars), artifacts, toolCalls, durationMs} — never the full
  transcript. Aggregation for isolated runs uses summaries.
- **Skill frontmatter `context: fork`** supported: `skillMeta()` now exposes
  `context`, plus `skillWantsIsolation(slug)` in SkillChain.
- **Test seam**: AgentLoop honors `opts.__mockAnswer` so isolation is provable
  without LLM keys.

### Evidence (isolation proven — marker never reaches parent-visible data)
New suite `server/test-subagent-isolation.js` (24 checks): a 5.6 kB mock
subagent transcript with a secret marker at position 600 (beyond the 350-char
parent-visible summary window).
```
✅ researcher definition loads with frontmatter
✅ researcher definition declares isolation (context: fork)
✅ isolated run returns a summary (bounded)
✅ isolated result does NOT carry the full transcript
✅ forked task result has summary, no full answer field
✅ forked subagent did NOT leak transcript into parent-visible data
✅ normal task keeps the full answer   ← non-forked unchanged
=== RESULT: 24 passed, 0 failed ===
$ cd server && npm test
exit=0 · 961 ✅ · 0 ❌
```

---

## Priority 3 — First-class coding loop with machine-checkable success predicate ✅ DONE

### Before
- The debug loop (Orchestrator `N.debugger`) was informal: run → regex-scan
  output for error text → `applyFix` → graph cycle. Success = `runResult.success
  && !looksLikeError`, where `looksLikeError` was a loose regex. No reusable
  loop component, no explicit success criterion, no attempt-count contract
  that tests could assert.

### After
- **`server/src/services/CodingLoop.js`** — first-class loop:
  - `successPredicateFromCriterion(criterion)` — machine-checkable criteria:
    `'exit-zero'`, `'exit-zero-no-error-text'` (default), `'contains:<text>'`,
    `'not-contains:<text>'`, or a predicate function `(exitCode, output) => bool`.
  - `runCodingLoop({goal, entryPoint, files, runCommand, writeFiles, fixer,
    successCriterion, maxAttempts=6, sendEvent})` — write → run → observe the
    EXACT error → fix → re-run; stops on predicate pass or hard budget;
    returns `{attempts, success, lastOutput, lastExitCode, files, attemptsLog}`.
  - `defaultFixer` feeds goal + the exact last error into the model (Coder role)
    and parses the fenced `{files, entryPoint}` reply; injectable for tests.
- **Wired into Coder/Runner/Debugger**: Orchestrator `N.debugger` now runs the
  whole fix phase through `runCodingLoop` (success criterion
  `exit-zero-no-error-text`, `maxAttempts = MAX_DEBUG_ATTEMPTS`), preserving
  the preview-open behaviour and the graph edges. `code_task` work therefore
  uses the loop by default. VerificationLoop (final answer quality) untouched.

### Evidence (multi-iteration fix, concrete)
New suite `server/test-coding-loop.js` simulates a broken script
`console.log(brokenVar)` → fixer pass 1 introduces `undefinedVar` → pass 2
prints DONE:
```
✅ loop iterated multiple times (attempts=3, got 3)
✅ loop succeeded once predicate passed
✅ fixer was called twice (2 fix passes)
✅ exact errors were observed and fed back (attemptsLog length 3)
✅ attempt 1 error recorded (brokenVar)
✅ attempt 2 error recorded (undefinedVar)
✅ attempt 3 clean output recorded (DONE)
✅ budget exhausted at 4 attempts   (never-fixing fixer)
✅ budget exhaustion reports failure
=== RESULT: 18 passed, 0 failed ===
$ cd server && npm test
exit=0 · 937 ✅ · 0 ❌
```

---

## Priority 2 — Always-on knowledge + progressive knowledge loading ✅ DONE

### Before
- No `server/knowledge/` tree at all. Memory/books existed, but no permanent
  cheap always-on project-knowledge file, no progressive knowledge folders,
  no on-demand knowledge tool. Agents guessed at repo conventions.

### After
- **`server/knowledge/JEXI.md`** — always-on project knowledge: conventions
  (stack, `cd server && npm test`, layout), 5 non-negotiable rules (never invent
  sources, verify code by running, use tools, honest gates, preserve user work),
  pointers to the progressive folders.
- **2 progressive folders** (NOT always-on):
  ```
  server/knowledge/conventions/KNOWLEDGE.md   — style, failure-class fixes, catalog plumbing
  server/knowledge/architecture/KNOWLEDGE.md  — Planner→Orchestrator→skills→tools map, where to add things
  ```
- **`server/src/services/KnowledgeBase.js`** — `loadProjectKnowledge()` (cached),
  `knowledgeLoad(category)` (path-traversal-safe, null on unknown),
  `listKnowledgeCategories()`, `knowledgeStatus()`.
- **Always-on injection**: `JexiPrompt.js` now appends `# PROJECT KNOWLEDGE
  (always-on — B50 P2)` + JEXI.md to `JEXI_SYSTEM_PROMPT` — every session gets
  it (Orchestrator / AgentLoop / SkillChain all build on this prompt).
- **Tool**: `knowledge-load` registered in ToolRegistry (agents: jexi,
  context-manager, archivist, coder, engineer, researcher; engine KnowledgeBase).

### Evidence
```
$ node --input-type=module -e "import {JEXI_SYSTEM_PROMPT} from './src/services/JexiPrompt.js'; …"
prompt length: 12429
has JEXI.md marker: true            ← always-on injection works
has conventions body (should be false): false   ← progressive, not always-on
$ node test-knowledge-base.js
=== RESULT: 12 passed, 0 failed ===
$ cd server && npm test
exit=0 · 919 ✅ · 0 ❌
```
- Tool count 175 → **176** (knowledge-load); AGENT-CATALOG regenerated
  (251 agents · 507 skills · 176 tools).

---

## Priority 1 — Progressive-disclosure skills ✅ DONE

### Before
- Skills were flat single `.md` files; only 4 existed (`product.md`, `engineer.md`,
  `reviewer.md`, `security-officer.md` — 22 lines each). `coder`/`qa`/`reflector`
  had no file at all and loaded via roster **synthesis** at runtime.
- `SkillChain.loadSkill()` (server/src/services/SkillChain.js) matched only flat
  `-<slug>.md` files, then synthesized. No folder format, no planning-time metadata,
  no frontmatter beyond name/slug/role.

### After
- **7 progressive folders** created, each with `SKILL.md` (YAML frontmatter:
  `name`, `description`, `allowed-tools`) + `reference.md` (full detail):
  ```
  server/skills/product/SKILL.md + reference.md
  server/skills/engineer/SKILL.md + reference.md
  server/skills/coder/SKILL.md + reference.md
  server/skills/qa/SKILL.md + reference.md
  server/skills/reviewer/SKILL.md + reference.md
  server/skills/security-officer/SKILL.md + reference.md
  server/skills/reflector/SKILL.md + reference.md
  ```
- **SkillChain.js updated** (file: server/src/services/SkillChain.js):
  - `skillFolder(slug)` — detects `skills/<slug>/SKILL.md` (raw slug first, then
    alias-resolved, so `security-officer` → folder works).
  - `parseFrontmatter(md)` — YAML frontmatter parser.
  - `skillMeta(slug)` — **planning-time metadata: name + description ONLY**.
  - `planningSkillSummaries()` — cheap list for the Planner (never loads bodies).
  - `loadSkill(slug)` — folder preferred → merges SKILL.md + reference.md at
    **execution** time; flat file next; roster synthesis kept as LOGGED fallback
    (no behavior regression for the other chain slugs: designer, shipper, critic…).
- **Decision (logged per directive):** the 4 legacy flat files are left on disk as
  fallbacks — folders are strictly preferred (proven by test), so the flat files
  are inert for these 7 slugs. No data deleted.

### Evidence (progressive loading proven)
```
$ node --input-type=module -e "import {skillMeta,loadSkill,skillFolder} from './src/services/SkillChain.js'; …"
product | folder: true | progressive: true | bodyLen: 2765
coder   | folder: true | progressive: true | bodyLen: 3017
security-officer | folder: true | progressive: true | bodyLen: 2674
reflector | folder: true | progressive: true | bodyLen: 1952
planning list is cheap (no full bodies): true
```
- Planning-time summary = name + description (< 400 chars JSON). Reference phrases
  ("OWASP", "Rubric", "acceptance criteria are machine-testable") appear in the
  execution body but **never** in the planning context.

### Tests
New suite: `server/test-skill-progressive.js` (50 checks).
```
$ cd server && node test-skill-progressive.js
… 50 passed, 0 failed ===
$ cd server && npm test
exit=0  ·  907 ✅  ·  0 ❌
```
(Suite registered in server/package.json test chain.)

---
