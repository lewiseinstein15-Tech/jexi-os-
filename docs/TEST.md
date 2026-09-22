# 🧪 JEXI OS — Testing

All tests live in `server/` and run with plain Node (no test framework needed).

## Run everything

```bash
npm install           # repo root: required for the UI render suites (react)
cd server && npm install  # server deps
npm test              # from the repo root (forwards to server)
# or
cd server && npm test  # directly
```

This runs every suite sequentially (170+ files — see the `test` script in
`server/package.json`, the authoritative list). A failure stops the run
(exit code 1). Without the root `npm install`, the four UI suites that
render React components (`test-rich-render`, `test-b197`, `test-b200`,
`test-b206b`) crash on a missing `react` package — install first.

## The suites

| File | Covers |
|------|--------|
| `test-planner-routing.js` | Intent detection & team routing (44+ cases incl. compound "research then build" and confirmation-resume) |
| `test-new-agents.js` | New specialist agents (27 checks) |
| `test-books.js` | Book library save/search/delete |
| `test-chat-books.js` | "What does my book say…" answer path |
| `test-preview.js` | Preview/file endpoints on an isolated workspace |
| `test-pdf.js` | PDF parsing & import |
| `test-perf.js` | Perf Agent knowledge files (12 checks) |
| `test-llm-models.js` | Model name selection & fallbacks |
| `test-planner-orchestrator.js` | Plan → executePlan handoff |
| `test-trusted-library.js` | Trusted Library routing |
| `test-memory-preferences.js` | Mem0-style preference learner |
| `test-memory-vector.js` | Hybrid vector+keyword memory (TencentDB pattern) |
| `test-context-resolution.js` | Conversational continuity (anaphora + query rewriting) |
| `test-roster-skills.js` | Agent/skill/tool catalog integrity + auto tool routing |
| `test-mcp.js` | MCP endpoint: initialize, tool/resource allowlist, tool call |
| … | (170+ further suites — the `test` script in `server/package.json` is the full list) |
| `test-agent-contracts.js` | M3: professional agent contracts + spawn gate (26 checks) |
| `test-context-engine.js` | M4: context budgets, repo map, token caps (32 checks) |
| `test-recovery-lessons.js` | M5: coding failure/recovery lessons (15 checks) |
| `test-judge-gates.js` | M6: independent judge gate (24 checks) |
| `test-code-intel.js` | M7: lsp symbols + diagnostics (19 checks) |
| `test-setup-wizard.js` | M8: phone setup wizard + probes (22 checks) |

## Notes

- Tests self-isolate (own temp data/workspace dirs) so they never pollute your real knowledge library.
- A couple of suites exercise the memory core; if you have a custom `DATA_DIR`, tests still use a temp dir.
- CI (`.github/workflows/ci.yml`) runs these on every push to `main` plus the frontend `vite build`.
