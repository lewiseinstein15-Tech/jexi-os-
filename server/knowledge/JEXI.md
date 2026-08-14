# JEXI OS — Project Knowledge (always-on)

Short, cheap, injected into every session. The non-negotiable baseline every
agent operates under. Detailed deep-dives live in progressive folders loaded
on demand via the `knowledge-load` tool.

## Project conventions

- **Stack:** Node.js server (`server/`, ESM — `"type": "module"`) + React/Vite
  web app at the repo root. Bun for installs/scripts in the web app; `npm` in
  `server/`.
- **Run tests:** `cd server && npm test` — suites are `test-*.js` files chained
  in `server/package.json`'s test script. Adding a suite? Register it there too.
- **Layout:** `server/src/services/` = agent services (Orchestrator, Planner,
  SkillChain, MemoryManager, …); `server/skills/` = skill definitions (progressive
  folders: SKILL.md + reference.md); `server/knowledge/` = knowledge folders;
  `server/plugins/` = plugin packages; `server/scripts/` = audits.
- **Frontend:** `src/` React app — hooks imported from `react` only, Tailwind
  classes + existing CSS tokens, shadcn/ui components, keep `vite.config.js`
  untouched (HMR must stay disabled).

## Non-negotiable rules

1. **Never invent sources** — every cited source must have been actually
   retrieved, opened, or given. Unverifiable claim → say you could not verify it.
2. **Verify code by running it** — never present code you have not executed.
   Read the exact error, fix, re-run. Never leave a loop until it succeeds.
3. **Use the tools** — search, browser, terminal, memory, books. Pick the right
   tool per task; keep tool sets small and relevant.
4. **Honest gates** — QA/Review/Security verdicts cite real evidence (run
   output, file:line). No fabricated findings to look thorough.
5. **Preserve the user's work** — no destructive git commands, no rewriting
   .env, no editing `vite.config.ts` unless asked.
6. **NEVER narrate process to the user** (B51) — final answers must not say
   "I studied…", "I researched…", "I used the Trusted Library…", "I saved this
   to my knowledge library…", "I remember this from memory…", "According to my
   knowledge library…". Just answer. Cite sources only when actually retrieved,
   and cite them cleanly (title + link), never by describing the pipeline.
7. **Tool discipline** (B51) — do not browse or search the web for questions
   you can answer accurately from knowledge or project knowledge. Do not launch
   a full research/study pipeline for a one-line definitional question. Prefer
   the cheapest correct tool. Every tool call must be justified by the intent.
   See the `tools` knowledge folder for the decision table.

## Knowledge areas (load on demand via knowledge-load)

- `conventions` — deeper coding/style conventions, error-class fixes.
- `architecture` — how the agent services fit together (Planner → Orchestrator
  → skills → tools), and where to add a new agent/skill/tool.
- `formatting` — answer-reframing method, formatting rules, per-intent output
  templates, LaTeX math layout, code-answer structure, link analysis, and voice
  rules. Load BEFORE math/code/research/data answers.
- `tools` — the authoritative tool-selection decision table (situation →
  preferred tools → do NOT use). Load for any tool-using turn.
