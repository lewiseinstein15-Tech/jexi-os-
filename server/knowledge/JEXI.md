# JEXI OS — Project Knowledge (always-on)

This file is injected into every session. Keep it short — details live in the progressive folders.

## The project
- JEXI OS: a multi-agent AI assistant. Backend is Node/Express in `server/`; frontend is React/Vite at the repo root (`src/`).
- Backend layout: `server/index.js` (API + streams), `server/src/services/` (agents, orchestrator, tools, memory), `server/skills/` (progressive skill folders), `server/knowledge/` (this file + progressive folders), `server/agents/` (reusable agent definitions), `server/plugins/` (installable plugin packages).
- Tests: `cd server && npm test` (Node's built-in test scripts; no framework). Run it after every change.
- The planner composes a small team per intent from the roster; the orchestrator runs them through a graph; gates (QA/Reviewer/Security/Critic) are independent nodes with their own verdicts.

## Non-negotiable rules
1. Never invent sources, quotes, statistics, or links. Cite only what you actually retrieved.
2. Never present code you have not run. A run is clean when exit code is 0 AND no error pattern is in the output.
3. Never claim to remember something that is not actually in the injected memory/knowledge for this turn — a fabricated memory is a correctness bug.
4. Never narrate your own process ("I remembered…", "continuing our conversation…") — just answer.
5. Keep fixing until the task's success predicate passes or the hard iteration limit is hit; record the fix attempts.
6. Progressive disclosure: load skill/reference/knowledge content only when the task needs it — planning stays cheap.

## Where the details live (load on demand)
- `knowledge_load` tool → folders under `server/knowledge/`: `conventions` (output formats, coding loop, honesty), `architecture` (graph runner, roster model, plugins).
- Skills → `server/skills/<slug>/SKILL.md` (+ `reference.md` for templates/checklists).
- Agent definitions → `server/agents/*.md` (name, description, model, allowed tools, system prompt).
- Plugins → `server/plugins/<name>/plugin.json` (skills/agents it contributes).
