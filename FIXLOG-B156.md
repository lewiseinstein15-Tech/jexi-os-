# FIXLOG B156 — missing API surface, chat memory, stream crashes

**Date:** 2026-08-23 · **Repo:** lewiseinstein15-Tech/jexi-os- · **Branch:** arena/01a02eac-jexi-os

The services for conversations, goals, updates, projects and the DSH
diagnostics endpoints existed, but `server/index.js` never mounted them.
The v3 History / Workshop / Settings / Goals screens (and `test-everything`)
called those URLs and got 404s. Chat also never wrote facts or conversation
logs, so History stayed empty and "what's my name?" forgot.

## Fixes

1. **Mount the missing API surface** (`server/src/routes/surface.js`)
   Conversations, session-query, projects, goals (+ stream/info),
   `/api/update/version`, brand, plugins inventory/runtime, permissions,
   personas, host/gateway/config, push/FCM, skills discovery + marketplace,
   and the rest of the DSH diagnostic GETs the gauntlet probes.

2. **Chat actually remembers**
   Every `/api/chat` turn now `addChat`s (fact extraction) and appends to
   the per-conversation JSONL log. `conversationSummary` includes
   `firstMessage` so History can show a preview.

3. **Goal jobs were dead**
   `goalEngine` was constructed with no planner/orchestrator. Boot now
   injects them, wires `setGoalExecutor` / notifier / email connector, and
   hydrates jobs from Redis.

4. **Frontend stream crash**
   `consumeStream` called `setQuestions` / `setPlanReview` out of scope
   (`ReferenceError` on ask-user / plan-review events). They are now
   passed in. `backendUrl` is declared outside `try` so the catch path
   no longer throws `ReferenceError`.

5. **`/api/models`** now returns a JSON `workers` array (the Models screen
   expected that) instead of a function that `res.json` silently dropped.

6. **Path safety + XSS** on `/api/files` and `/preview` via `resolveInside`
   and HTML-escaping of the filename.

7. **Production fail-closed** if `NODE_ENV=production` and no
   `JEXI_API_KEY` (unless `JEXI_ALLOW_UNLOCKED=1`). Update-version is an
   open path so the APK banner still works on a locked server.

8. **Vite `index.html`** (the one actually built) now has the B70
   no-cache headers that had only been added to unused `src/index.html`.

9. **Dockerfile** copies `public/` (service worker) into the image.

10. **`app.py`** no longer auto-commits/pushes or uses a hardcoded secret
    — that leftover Aider wrapper is what produced the `Jexi: Hi...` dump
    commit.

11. **Schedules** accept `kind`, `autonomy`, `dailyAt` from the Goals UI.
