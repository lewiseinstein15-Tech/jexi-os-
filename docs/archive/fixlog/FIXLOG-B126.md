# FIXLOG-B126 — Coding rebuilt exactly like DeepSeek Harness: autonomous, model-driven

**Phase:** B126 · **Branch:** main

## What DSH does (packages/shell/tool-bash + packages/fs/tool-fs)
No coding TEAM. The model drives coding itself:
- `bash(command, description, timeoutMs?, workdir?)` — run/verify commands
- `write(file_path, content)` — create/replace files
- `read(file_path)` / `edit(file_path, old_string, new_string)` — inspect + targeted edits
- (DSH also uses run_in_background for servers and its sandbox for safety)

## What JEXI had
An 11-agent coding pipeline: Product → Designer → Engineer → Coder → Runner →
Debugger → QA → Reviewer → Security → Shipper → Reflector (orchestrator team).

## What was built (B126)
1. **`server/plugins/coding/plugin.js`** — mounts the DSH coding tool set:
   `bash` (runCommand, ≤120s, description param), `write` (create/update + before/
   after), `read`, `edit` (exact-string replace or full), `list_files` — all with
   DSH-shaped contracts and workspace path-safety. Plus the **coder skill**
   (progressive, custom rank 300) teaching the plan → write → run → fix → verify loop.
2. **`server/src/services/AutonomousCoding.js`** — the runner: loads the coder skill
   into the prompt, offers ONLY bash/write/read/edit/list_files/run_in_background/
   preview-server, runs the native loop (max 12 iterations), collects written files,
   and returns { success, summary, files, preview?, statistics } — including a live
   preview link when the workspace has an index.html (a real upgrade over the team).
3. **Routing**: `code_task` + `compound_task` now go to the autonomous runner — the
   coding team is bypassed entirely. Research stays on the DSH runner (B125);
   everything else unchanged.

## Verified
- Tools through the gate in a real isolated workspace: write→read→edit→bash(node
  app.js → "hello")→list_files; path traversal refused; edit with missing old_string
  fails honestly; bash failures reported honestly.
- Runner (deterministic seam): write→bash→summarize with files collected + stats;
  degraded result honest when providers fail.
- coder skill discovered (custom/300) + body loads.
- test-autonomous-coding 29/29; plugins-all 43/43 (12 plugin tools); builder +
  coding-loop suites still green; full 55-suite sweep exit 0; lint 0.
- Deployed to Render via hook.
