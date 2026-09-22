# FIXLOG-B125 — Research rebuilt exactly like DeepSeek Harness (tool-web mirror)

**Phase:** B125 · **Branch:** main

## What DSH does (from packages/web/tool-web)
There is NO research team pipeline. The model drives research itself:
- `web_search(query)` → `{ content?, sources: [{url,title,snippet,publishedAt}], truncated }`
- `web_fetch(url)` → `{ url, statusCode, body: {kind:'html'|'text', content}, truncated }`
- The prompt tells the model: search → follow up with web_fetch on specific results → cite URLs as markdown links. The model iterates until it can synthesize.

## What JEXI had
A multi-agent pipeline: Query Analyzer → Searcher → Re-ranker → Extractor → Synthesizer (orchestrator team), with results the user found weak.

## What was built (B125)
1. **`server/plugins/research/plugin.js`** — mounts the DSH tool-web pair with the EXACT DSH contracts:
   - `web_search` (backed by JEXI's multi-engine aggregateSearch; ≤10 sources, snippets, publishedAt)
   - `web_fetch` (backed by extractContent; full page text, statusCode, truncated)
   - Plus the **research skill** (progressive SKILL.md body + reference) registered on the context → auto-discovered at custom rank 300 → loadable via skill-load.
2. **`server/src/services/DshResearch.js`** — the model-driven runner: assembles the prompt + the loaded research skill, offers ONLY web_search/web_fetch/skill-load/subagent, runs the native tool loop (max 10 iterations), collects sources from web_search results for the UI, and falls back to evidence-synthesis if the loop caps out. Returns the same { success, summary, sources, statistics } contract as the old pipeline.
3. **Routing**: `research` AND `learning_research` intents now route to `runDshResearch` in the main chat path — the orchestrator research team is bypassed entirely. Other intents (code_task, compound_task, …) unchanged.

## Verified
- Plugin: web_search returns sources[] with urls; web_fetch returns body{} + statusCode 200 on a real page; honest failures for bad urls/missing queries.
- Runner (deterministic seam): search → synthesize with headings + collected sources; degraded result is honest when providers fail.
- Research skill discovered (custom/300) + body loads.
- test-dsh-research 27/27; test-plugins-all 33/33 (7 plugin tools incl. web_search/web_fetch); auto-mode 61/61; planner-routing green; full 55-suite sweep exit 0; lint 0.
- Deployed to Render via hook.
