# 🧪 JEXI OS — Testing

All tests live in `server/` and run with plain Node (no test framework needed).

## Run everything

```bash
npm test              # from the repo root (forwards to server)
# or
cd server && npm test  # directly
```

This runs all 15 suites sequentially — a failure stops the run (exit code 1).

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

## Notes

- Tests self-isolate (own temp data/workspace dirs) so they never pollute your real knowledge library.
- A couple of suites exercise the memory core; if you have a custom `DATA_DIR`, tests still use a temp dir.
- CI (`.github/workflows/ci.yml`) runs these on every push to `main` plus the frontend `vite build`.
