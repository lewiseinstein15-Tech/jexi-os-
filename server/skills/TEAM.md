# 🏢 JEXI's Specialist Team

JEXI turns every coding request into a small virtual engineering team. Each
specialist is a portable Markdown file in this folder with YAML frontmatter
(`name`, `role`, `phase`, `mandate`). The SkillChain engine (`server/src/services/SkillChain.js`)
runs them in order and **enforces the gates** — QA and Security verdicts block
shipping programmatically, not just by suggestion.

Every specialist was rebuilt by studying the best open-source implementations of
that role (gstack, agency-agents, AI-development-team, Aider, OpenHands, SWE-agent,
browser-use, Playwright MCP, CodeRabbit/PR-Agent, Reflexion, MetaGPT…) and keeping
only the patterns that survive real use. See the lineage under each row below.

## The sprint (Think → Plan → Build → Test → Review → Ship → Reflect)

| # | Skill | Role | Phase | Produces | Research lineage |
|---|-------|------|-------|----------|------------------|
| 01 | `product` | CEO & Product Lead | Think | `## PRODUCT BRIEF` | gstack /office-hours + /plan-ceo-review (scope modes, forcing questions) |
| 02 | `designer` | Senior Designer | Plan | `## DESIGN SPEC` | gstack /design-consultation (direction, anti-slop blacklist, embarrassment test) |
| 03 | `engineer` | Engineering Manager | Plan | `## BUILD PLAN` | OpenHands planning agent, gstack /plan-eng-review (edge cases, DoD) |
| 04 | `coder` | Staff Engineer | Build | `{ entryPoint, files[] }` (JSON) | Aider / SWE-agent harness (self-check loop, strict output contract) |
| 05 | `qa` | QA Lead | Test | `## QA REPORT` — verdict `PASS` / `NEEDS FIX` | browser-use, Playwright MCP, agency-agents (fantasy-allergic skepticism) |
| 06 | `reviewer` | Senior Reviewer | Review | `## REVIEW NOTES` — verdict `APPROVED` / `NEEDS WORK` | CodeRabbit / PR-Agent (severity triage, bugs tests miss) |
| 07 | `security-officer` | Security Officer | Review | `## SECURITY REVIEW` — verdict `CLEARED` / `BLOCKED` | gstack /cso (OWASP-lite, zero-noise, secrets archaeology) |
| 08 | `shipper` | Release Engineer | Ship | `## SHIPPED` | gstack /ship (release notes, honest known-limits) |
| 09 | `reflector` | Reflector | Reflect | `## REFLECTION` (saved to memory) | Reflexion (verbal reinforcement, one actionable lesson) |

Plus the five specialist teams (each rebuilt the same way, from their own lineage):

| # | Skill | Role | What it does |
|---|-------|------|--------------|
| 10 | `search` | Search Agent | Specialist research team: Query Analyzer → Searcher → Re-Ranker → Extractor → Synthesizer (SearXNG + DDG + Bing + arXiv, cited answers) |
| 11 | `news` | News Agent | Specialist news team: Scout (parallel feeds) → Filter (dedupe + credibility) → Editor (cited digest) |
| 12 | `memory` | Memory Agent | tf-idf relevance, recency×importance×relevance scoring, consolidation, forgetting, user-fact memory |
| 13 | `computer-use` | Computer Use Agent | Numbered element eyes (browser-use / WebVoyager / Set-of-Mark) that DRIVE the browser |
| 14 | `vision` | Vision Agent | Camera eyes: MediaPipe face + hand landmarks on-device, creator-vs-stranger match, expressions/gaze, gesture control (thumbs-up, open-palm quiet, wave…), dHash scene gate → narrates ONLY when something changed |

And the **round-2 specialists** that complete the JEXI OS roster (from agency-agents,
PR-Agent, SWE-agent, MetaGPT DataInterpreter, ai-data-science-team, andrewyng/translation-agent,
gstack /benchmark, ai-data-science-team — the roles every serious multi-agent system ships):

| # | Skill | Role | What it does |
|---|-------|------|--------------|
| 15 | `github` | GitHub Agent | Real `gh`/`git` CLI: status, commit, push, PRs, issues, repo create — honest output, never a faked push |
| 16 | `data` | Data Analyst | Loads CSV/JSON (chat, file, URL), computes real statistics, generates a self-contained HTML chart |
| 17 | `devops` | DevOps Agent | Stack detection → Dockerfile + GitHub Actions CI → exact copy-paste deploy steps, verified with `node --check`/`py_compile` |
| 18 | `writer` | Technical Writer | README/API refs/how-tos grounded in the real workspace files — no generic filler |
| 19 | `translator` | Translator | Draft → critique → revise reflection loop (andrewyng/translation-agent pattern) |
| 20 | `perf` | Performance Engineer | Static perf scan with real numbers (bundle size, blocking scripts, N+1 fetches), top fixes, honest runtime-check commands |

**Routing:** each new specialist is a first-class intent in `Planner.js` (`github`,
`data`, `devops`, `docs`, `translate`, `perf`) and runs one-by-one through the
Orchestrator. GitHub mutating actions (commit/push/PR/repo) verify auth FIRST and
say plainly when a token is missing. Compound patterns (e.g. "build from news")
can chain any of these teams the same way.

## How a task gets planned & routed (plan first, then execute one-by-one)

Every request runs through JEXI's **Planner → Orchestrator** architecture (built
from the patterns that survive in LangGraph Supervisor, AutoGen GroupChatManager,
Plan-and-Solve, and CrewAI sequential processes):

1. **Planner classifies** — a fast deterministic regex classifier picks the intent
   (zero AI cost, instant, works with no API key).
2. **Planner announces the team FIRST** — before anything runs, the chat shows
   `🧠 Plan first — team for this task: …`, listing the exact specialists in
   order. The team for every intent lives in `TEAM_PLAN` in `Planner.js`.
3. **Orchestrator executes one-by-one** — each specialist runs in order and gets
   ONLY the previous specialist's output (strict handoff, `extractSection`). The
   live pipeline shows each step as it happens.
4. **Gates in code** — QA must PASS and Security must CLEAR shipping; failures
   send work back to the coder for a fix round.
5. **Compound tasks** — when a request needs two teams (e.g. "build a dashboard
   of today's news" → News Team gathers FIRST, then the Coding Team builds on
   that context), the Planner detects it (`compound_task`), names both phases up
   front, and the Orchestrator runs them in order, handing phase 1's output to
   phase 2. Add new compound patterns in `COMPOUND_DETECT` in `Planner.js`.

Ask JEXI *"how do you decide which agents to use"* — she explains this herself
(`explain_team` intent).

## Handoffs (strict)

Every skill outputs **one `## SECTION`** with a fixed contract. The engine
extracts only that section and hands it to the next specialist — roles never
see each other's working notes. Add or change a section title in a skill file
and update the matching `extractSection(...)` call in `SkillChain.js`.

## Gates (enforced in code)

- **QA gate** — verdict `NEEDS FIX` triggers the fix loop: coder fixes, runner
  re-runs, QA re-verifies. Only `PASS` proceeds.
- **Security gate** — verdict `BLOCKED` triggers one enforced fix round, and
  the summary says so plainly. This gate is **never skipped**, for any size of task.

## Safety commands (Planner)

- `/careful` — read-only QA (no clicks/types in the browser)
- `/freeze` — plan only, nothing written to disk
- `/unfreeze` — back to normal
- `/guard <paths>` — careful + only write files matching the named paths
- `/team` — explicit: run the full team

## Design principles (from studying 7+ open-source multi-agent systems)

1. **Role specialization with focused mandates** — each specialist knows one job
   and its exact output contract; no overlap, no drift.
2. **Structured chaining** — output of one role feeds the next; nothing else leaks
   across (smaller context, sharper results).
3. **Enforced gates, not suggestions** — QA and Security verdicts block shipping in code.
4. **Honesty over optimism** — QA is fantasy-allergic, the Security Officer never
   rubber-stamps, the Reflector tells the truth about fix rounds.
5. **Portable SKILL.md files** — any host can run these; the engine is just the chain.
6. **Anti-bloat** — we kept the patterns that survive real use and dropped the
   over-complicated ones (chatty agent-swarm loops, heavy frameworks, enterprise
   ticket integrations).

## Adding a specialist later

1. Copy an existing skill file, e.g. `cp 06-reviewer.md 10-data-engineer.md`.
2. Edit the frontmatter (`name`, `role`, `phase`, `mandate`) — the engine
   shows these in the live pipeline.
3. Define `## INPUT` and one `## OUTPUT` section with a strict contract.
4. Add the slug to `SKILL_META` / `PHASE` in `SkillChain.js` and chain it in
   `planForBuild`, `qaWebApp` or `reviewAndShip` at the right point.
5. Run `node --check server/src/services/SkillChain.js` and re-test.
