# FIXLOG-B129 — Frontend matches: tappable preview links in chat + PROJECTS screen

**Phase:** B129 · **Branch:** main

## The issue (user screenshot)
The chat showed the preview link as plain untappable text — react-markdown only makes
markdown-linked or <angle-bracket> URLs clickable; the bare
https://jexi-os-brain.onrender.com/preview/… URL JEXI now returns rendered as plain
text you can't tap.

## What was built
1. **Auto-linkify in MarkdownRenderer** — a pre-pass wraps every BARE http(s) URL in
   GFM autolinks (skipping URLs already inside markdown links, <> autolinks, and code
   backticks), so every URL in every answer is now TAPPABLE (opens in a new tab).
   Applied to the cleaned content (after math fix-ups).
2. **PROJECTS screen (nav: SYSTEM → Projects)** — the frontend face of project memory
   (B128): lists every build capsule with name, summary, file count, **OPEN PREVIEW**
   (tappable), last-active time, an expandable file list, and a **CONTINUE** button
   that sends "continue the <project>" straight into the chat. Auto-refreshes.

## Verified
- esbuild compiles NavList/ProjectsScreen/App/MarkdownRenderer.
- api-surface: 87 frontend endpoints ↔ server routes, 0 missing.
- test-preview 9/9, test-project-memory 22/22; full 55-suite sweep exit 0.
- Deployed to Render via hook.
