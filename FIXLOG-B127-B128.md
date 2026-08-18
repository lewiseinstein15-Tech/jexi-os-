# FIXLOG-B127+B128 — Tappable preview links + DSH project memory (continue anything)

**Phase:** B127+B128 · **Branch:** main

## B127 — Preview links were untappable (file://)
The user got `file:///opt/render/project/src/server/jexi-workspace/preview.html` — a
local path that can't be opened. Root cause: `preview-server` was a registry-only
tool (no engine → "routed"), so the model invented file:// paths from the absolute
workspace path.

Fix:
- **Real `preview-server` engine** in ToolRuntime → returns the TAPPABLE public URL
  (`https://jexi-os-brain.onrender.com/preview/<file>` on Render; the /preview route
  already served workspace files over HTTP).
- **`sanitizeModelOutput()`** — every model-facing tool result is scrubbed: `file://`
  and absolute workspace paths are rewritten to `/preview/<file>` URLs; plain text
  untouched. The model can now only ever produce tappable links.
- zod contract for preview-server; test-preview 9/9.

## B128 — Project memory: continue ANY project from ANY conversation (DSH mirror)
DSH remembers everything via append-only sessions + workspace state. JEXI now gets
durable **project capsules**:
- After every successful autonomous build → `saveProjectCapsule` writes
  {slug, name, files, summary, previewUrl, lastQuery, updatedAt} to DATA_DIR/projects/.
- Continuation phrasing ("continue the todo app", "go back to the calculator",
  "update my todo app", "add dark mode to todo") resolves the capsule (exact + fuzzy)
  and INJECTS it into the turn: files, last summary, and the tappable preview URL —
  so the model continues the real project instead of starting fresh.
- `GET /api/projects` exposes all capsules (UI can list them).
- test-project-memory 22/22 (save/list/find, speech-variant normalization, context
  injection, update-preserves-createdAt).

## Verification
- Full 55-suite sweep exit 0; lint 0; api-surface 86 endpoints 0 missing.
- On Render the preview URL resolves to https://jexi-os-brain.onrender.com/preview/…
  (tappable in any browser — including the phone).
- Deployed to Render via hook.
