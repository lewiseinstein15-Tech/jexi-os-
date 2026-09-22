# FIXLOG-B91.md — Universal Links · Autonomous GitHub Builder · File Uploads

Build 91 (Aug 16, 2026) — the "send me anything, I'll do it" release.

## 1. Universal Link Agent (`server/src/services/UniversalLinkAgent.js`)
ANY link + ANY instruction:
- Classify → video (YouTube/TikTok/Instagram/Vimeo), social
  (Facebook/X/LinkedIn/Reddit), or article/website.
- Video → watched **frame-by-frame** + full timestamped transcript
  (VideoAnalyzer); social → read via the real browser; article → deep-read
  (Readability with a lenient fallback).
- The user's instruction is applied to the extracted content by an LLM pass
  ("summarize it", "extract the recipe", "what did he say about X"…).
- Honest failures: login walls, empty pages, live streams — always explained.
- Live stream: link.start · link.classify · link.content · link.content-ready
  · link.answer · done.

## 2. Autonomous GitHub Project Builder (`server/src/services/BuilderAgent.js`)
- `/build <prompt>` — plan (Architect) → write → run → **fix loop
  (loop+graph: each round receives the EXACT last error, bounded 4 rounds)** →
  GitHub.
- No token → parks and asks for **repo name + token** (or reads
  GITHUB_TOKEN env / settings). Resume with `my-app github_pat_...` creates
  the repo via the GitHub API and pushes via git — token only in env, never
  printed or committed.
- Reports: files, run/fix rounds, run status, repo URL, honest caveats.

## 3. File uploads (`POST /api/upload` + chat attachments)
- Any file (PDF → text extracted, images → vision-ready, text/code → preview)
  up to 25 MB; stored in DATA_DIR/uploads; chat accepts `files:[{id}]` and
  injects the preview into the pipeline so planners/agents see it.
- Frontend: paperclip button in the home input — pick a file, chip shows,
  sends with the message.

## Verification
- New suites: test-universal-link 19/19 · test-builder 18/18
- 25-suite sweep green · lint 0 · live e2e: upload (43-byte txt → preview),
  link agent classifies + reads + honest error on content-less pages.
