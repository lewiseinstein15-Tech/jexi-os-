# FIXLOG B154 — GitHub repository analysis actually works now

**Date:** 2026-08-20 · **Repo:** lewiseinstein15-Tech/jexi-os- · **Branch:** main

## The problem
When the user shared a **GitHub repository link** ("analyze this repo
https://github.com/..."), JEXI routed it through the *generic article
reader* — the same path used for news pages. That path:

1. tried to deep-read the rendered GitHub page, which is a JavaScript app,
   so Readability either returned **navigation garbage** ("BranchesTags
   Latest commit History3 Commits Folders and files…") or **nothing at all**
   ("no readable content") → the user got "hitting a problem";
2. never once cloned, mapped, or reviewed the actual repository — the
   B151 repo-review guidance lived in the coding skill, but the link
   shortcut swallowed the message **before** the planner ever ran;
3. failures were logged as "unknown chat failure" because the done event
   dropped the real error (empty `error` field) and the event logger had
   no fallback.

Live evidence: `/api/events` showed repeated `unknown chat failure` on
Aug 19 18:12 and 20:29 right after "analyze the original repo" requests.

## The fix — a real GitHub Repository Analyzer (B154)

**New: `server/src/services/GitHubRepo.js`**

- `classifyGithubUrl` — parses ANY github.com/owner/repo shape (www,
  trailing `/`, `.git`, `?query`, `/tree/<branch>/<path>`, `/blob/...`,
  raw.githubusercontent.com, gist, non-repo site sections).
- `analyzeGithubRepo` — the full analysis pipeline:
  1. **Metadata** — GitHub REST API: description, language, ⭐ stars, forks,
     open issues, license, size, topics, default branch, archived, last push.
  2. **File tree** — recursive `git/trees` (capped at 1500 files, junk
     dirs like node_modules/dist/build/vendor skipped), grouped into
     top-level directories + language histogram.
  3. **README + key manifests** — fetched raw (README.md, package.json,
     requirements.txt, pyproject.toml, Cargo.toml, go.mod, Dockerfile…).
  4. **Structured report** — LLM pass produces OVERVIEW → ARCHITECTURE →
     KEY FILES → STRENGTHS → ISSUES (file paths) → FIXES → VERDICT. If the
     LLM is down, a **deterministic report** is built from the same real
     data — the user ALWAYS gets a genuine analysis, never a blank.
  5. **Fallback** — if the GitHub API is rate-limited/unreachable, a
     shallow `git clone` maps the working tree instead.

**Wiring:**

- `UniversalLinkAgent` — GitHub repo links now classify as `github-repo`
  and dispatch to the analyzer (never the article reader). All other link
  types (video/social/article) are unchanged.
- `DshResearch` — the research skill now carries GitHub-API URL recipes
  + the report structure, so "analyze the original repo" WITHOUT a fresh
  link (planner routes to research) also produces a real review.

**Honest diagnostics (no more "unknown chat failure"):**

- The chat route's link branch and the orchestrator `done` event now
  carry the real `error` through to the stream.
- `ChatEventLogger` falls back to the first line of the summary when no
  error field exists — every failure is now attributable.

## Verification
- New suite **`test-github-repo.js` — 34 checks**: URL parsing (11),
  routing (4), API+deterministic report (7), LLM report path (3), honest
  failures (4, incl. git-clone fallback), UniversalLinkAgent routing (5).
  Added to `npm test` chain.
- Full suite: **all 100 suites exit 0** (incl. test-universal-link 19/19,
  test-everything 134-check gauntlet).
- Live end-to-end against the real GitHub API: `octocat/Hello-World` and
  `lewiseinstein15-Tech/jexi-os-` analyzed in ~0.6–1.5 s — real stars,
  real tree (650 files for jexi-os-), real README, structured report.
- Server boot + `/api/chat` with a GitHub link streamed `link.start →
  link.classify → link.github.meta → link.content-ready → link.answer →
  done(success:true)` with the full report.

## Build
APK **apk-build-NN** (see release tag) — install it once from the in-app
update or the release page. No data loss: this is a backend + chat change.
