# PHASE 24 CONSOLE REBUILD — FINAL GATE REPORT (Scope F)

Date: 2026-09-22 · Branch: `phase-24-rebuild` · Base: `main` @ merge-base `6db21f3`

## 1. Rollback tag
`pre-phase-24-final` → this evidence commit's SHA (see §2; tag created via ID-based Git Data API, disclosed below).

## 2. Branch SHA at gate
See commit this file ships in (HEAD of `phase-24-rebuild` at tag time). Parent: `5e5c9f5b80b6e73019d32ded816472558d299249` (Scope E, APPROVED).

## 3. Scope verdicts + evidence
| Scope | Commit | Verdict | Evidence |
|---|---|---|---|
| 0 design spec + tokens | `637e9e8` | APPROVED | docs/phase24-scope0-*.png, spec md |
| 0c palette preview | `67669f6` | APPROVED | palette swatches/test-surface renders |
| A shell + tokens | `284c72a` | APPROVED | docs/phase24-scopeA-*.png |
| cleanup (lead-ordered) | `4a6a0ac` | APPROVED | 89 pre-24 PNGs purged, history retained |
| B chat surface | `f698784` | APPROVED | docs/phase24-scopeB-*.png |
| C settings surface | `87da794` | APPROVED | docs/phase24-scopeC-*.png |
| D work graph surface | `f628f8f` | APPROVED | docs/phase24-scopeD-*.png |
| E polish pass | `5e5c9f5` | APPROVED | docs/phase24-scopeE-*.png |
| F walkthrough + gate | this commit | FINAL GATE | docs/phase24-scopeF-walkthrough-*.png |

## 4. Full suite (this environment: Node v20.20.2)
`node scripts/run-tests-chunked.js` → **pass: 196 · fail: 14 · total: 210** (196 + 14 = 210 ✓)

## 5. Regression classification (all 14 failures)
**Environment (6)** — fail identically on a pristine origin/main tree in THIS environment
(proven by re-running the same commands on an API-tarball checkout of main):
- test-commands (2 env checks: docker/binary presence class)
- tests/agi/test-workgraph-persistence — `node:sqlite unavailable`
- tests/agi/test-verification-independence — `node:sqlite unavailable`
- tests/agi/test-verification-spawn — `node:sqlite unavailable`
- tests/agi/test-scheduler — `node:sqlite unavailable` (persistent queue disabled)
- tests/agi/test-memory-provider — `SqliteMemoryBackend.insert` requires node:sqlite
Root cause: this sandbox runs Node v20.20.2; `node:sqlite` needs Node ≥ 22. The 204/6
baseline was measured on Node ≥ 22. Known env flakes test-dsh-batch7 / test-b209 PASSED here.

**Named, expected-by-design (8)** — each fails ONLY on checks that exercise the legacy
`src/components/ChatWindow.jsx` UI, which APPROVED Scope B replaced with the Phase 24
console wrapper (charter: "Surfaces: Chat · Settings · Work Graph only"; legacy HUD
features intentionally removed):
- test-auto-mode — "send passes the composer draft + image (B195 isolated Composer)"
- test-model-coworkers — "chat header shows the writer NAME while streaming"
- test-web-search — "streaming caret rendered while a coworker writes"
- test-thinking — "ChatWindow renders the thinking panel above the answer"
- test-audit-b48 — avatar/bubble + Copy/Regenerate checks (2)
- test-b200 — "the chat renders the NarrationFeed on the assistant message"
- test-b205 — "ChatWindow renders the unified AgentThinking panel"
- test-b226 — hidden image input / message image checks (2)
Each passes on pristine main in this environment (proven). These tests target removed
surfaces; they need retirement/rewrite against the Phase 24 console (carry-forward §8).

**Regressions outside the approved design: none.**

## 6. Invariants (raw in Scope F chat report; classification)
1. Credential-shaped strings in ui/web/console/** + src/components/: 1 hit =
   `KeyRefInput.jsx` INLINE_VALUE_RE — the refusal guard regex, not a credential.
2. Network calls in ui/web/console/**: `mount.js` + `Header.jsx` fetch `/api/health`
   (expected); `Graph.jsx` fetches `/api/missions` (approved Scope D data source).
   Other hits are UI config strings (model catalog, placeholder). No LLM calls in UI.
3. TODO/FIXME/XXX in Phase 24 zones: none.
4. Imports of server/** from Phase 24 modules: none.
5. Error classes: no `class … extends Error` anywhere in Phase 24 zones; runtime
   modules use the pre-existing Phase 16 `fail()` plain-Error pattern; Graph throws
   plain `Error`. No new error class.

## 7. CI
**none** — `/actions/runs?branch=phase-24-rebuild` → `total_count: 0` (no CI configured on repo).

## 8. Carry-forward → ZONE-OWNER.md items
- Chat checkpoints UI not wired (runtime module `chat/checkpoints.js` exists; no console control)
- Artifact panel UI not wired (`chat/artifacts.js` exists; no console surface)
- Queue/steer UI not wired (`chat/queue.js`, `chat/steer.js` exist)
- Multi-agent view not wired (`chat/multiagent.js` exists)
- Full provider setup: real LLM answer path (no provider configured in this env; answers are the deterministic in-process default agent)
- Server-side wiring for chat runtime backend (chat runtime is in-process; brain hosts graph/health APIs only)
- Agents View wiring into console nav (Phase 10 J)
- Legacy UI test retirement/rewrite: test-b200, test-b205, test-b226, test-audit-b48, test-auto-mode, test-model-coworkers, test-web-search, test-thinking (target removed legacy ChatWindow surfaces)

## 9. Files changed vs main (diff --stat equivalent, API compare main...HEAD)
**169 files changed, 5015 insertions(+), 402 deletions(-)**
by top dir: android 50 (cleanup deletions), assets 7 (cleanup deletions), docs 77, ui 24, scripts 8, src 1 (ChatWindow.jsx), package.json 1, package-lock.json 1.

## 10. Commits ahead of main (8)
```
637e9e8 phase-24(0): design spec + tokens
67669f6 phase-24(0c): palette preview renders
284c72a phase-24(A): shell + tokens
4a6a0ac phase-24(cleanup): purge pre-24 evidence PNGs (lead-ordered; history retained)
f698784 phase-24(B): chat surface
87da794 phase-24(C): settings surface
f628f8f phase-24(D): work graph surface
5e5c9f5 phase-24(E): polish pass
+ this evidence/report commit (9th)
```

## 11. NOT VERIFIED
- Walkthrough P6 (artifact panel) and P10 (checkpoint UI): surfaces not wired in Phase 24 console — marked NOT VERIFIED with reason; no fixtures faked.
- Real LLM answer: no provider configured in this environment — P4 answer is the deterministic in-process default agent (stated explicitly, per directive).
- `git merge-tree --write-tree`, `git ls-remote`, `git rev-parse`, `git status/diff/log`: no local `.git` (sandbox boundary wipes it) and GitHub name-based endpoints 404 repo-wide (ID-based endpoints work). Substituted, disclosed: ID-based Git Data API for commit/tag/ref; API compare for diff/log/zero-deletion; structural merge proof (file-set intersection main-side ∩ branch-side = 0 → no possible content conflict).
- Walkthrough-6 / walkthrough-10 PNGs do not exist (unreachable surfaces).
- e-before / e-offline scripts not re-run at this gate (before-capture is by definition pre-polish; offline error states verified live at Scope E gate).
