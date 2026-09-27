# REPO-CLEANUP — 2026-09-27

Executed under Phase 0 delete authority. After this document was committed, no
further deletions are authorized for this task (replaced code moves to `_legacy/`).

## 1. Branches deleted (10) — all proven merged into main via `git merge-base --is-ancestor origin/<branch> origin/main` (exit 0)

| Branch | Merge proof |
|---|---|
| `fix/chat-memory-provider-wiring` | ancestor of main (merge commit `40767581` = merge of this branch) |
| `fix/chat-wiring-completion` | ancestor of main (merge commit `ba57c1ab` = merge of this branch) |
| `fix/dockerfile-packaging-gap` | ancestor of `origin/main` (`merge-base --is-ancestor` exit 0) |
| `fix/slim-server-image` | ancestor of `origin/main` (`merge-base --is-ancestor` exit 0) |
| `fix/restructure-residuals` | ancestor of `origin/main` (`merge-base --is-ancestor` exit 0) |
| `cleanup/consolidated-final` | ancestor of `origin/main` (`merge-base --is-ancestor` exit 0) |
| `cleanup/consolidated-v2` | ancestor of `origin/main` (`merge-base --is-ancestor` exit 0) |
| `restructure/file-structure` | ancestor of `origin/main` (`merge-base --is-ancestor` exit 0) |
| `verification/phase-30-31-reverify` | ancestor of `origin/main` (`merge-base --is-ancestor` exit 0) |
| `investigation/excluded-scopes` | ancestor of `origin/main` (`merge-base --is-ancestor` exit 0) |

Also noted: `fix/decision-layer-rendering-ui` does not exist on the remote (checked
via `git rev-parse --verify origin/fix/decision-layer-rendering-ui` → absent).

## 2. Branches NOT deleted (8) — NOT merged into main (`merge-base --is-ancestor` exit 1), per instruction "report, skip, do NOT delete"

| Branch | Why kept |
|---|---|
| `ui/rebuild-premium` | 28 files / 2895 insertions not on main (premium.css, shortcuts.js, toasts.jsx, tokens-premium.css, useStatus.js, …) |
| `verification/phase-28-30` | report `docs/VERIFY-PHASE-28-30.md` (390 lines) not on main |
| `verification/phase-31` | report `docs/VERIFY-PHASE-31.md` (486 lines) not on main |
| `verification/chat-wiring` | report `docs/VERIFY-CHAT-WIRING.md` (315 lines) not on main |
| `verification/chat-wiring-gap6` | report `docs/VERIFY-CHAT-WIRING-GAP6.md` (325 lines) not on main |
| `investigation/a2a-superpowers` | report `docs/PHASE31-A2A-SUPERPOWERS-INVESTIGATION.md` (235 lines) not on main |
| `investigation/arena-status-recall` | report `docs/ARENA-STATUS-RECALL.md` (305 lines) not on main |
| `ui/rebuild-premium-v2` | not in the delete list (it IS merged; left in place as out-of-scope, candidate for a future cleanup pass) |

## 3. Tags deleted (163) — stale `apk-build-*` baselines older than 30 days (creatordate < 2026-08-28)

Keep policy applied:
- `v*` releases: none exist on this repo; `apk-v0.*` versioned release tags kept (all within 30 days).
- `apk-build-*` recent baselines: kept all dated ≥ 2026-08-28 (`apk-build-175` … `apk-build-494`).
- `pre-*` tags for currently active branches: `pre-ui-decision-layer` kept (active branch `ui/decision-layer-rendering`); all other `pre-*`/`post-*` tags are within the 30-day window and were kept.
- Deleted: `apk-build-3` … `apk-build-174` (163 tags, dated 2026-08-08 … 2026-08-24), e.g.
  `apk-build-3, 4, 5, …, 90, 91, 92, 93, 95, 96, 97, 99, 100–174`.
- Command: `git push origin --delete refs/tags/<tag>` + `git tag -d <tag>`; 163 deleted, 0 failures.
- Tag count: 618 → 455.

## 4. `_legacy/` folders removed (1)

- `interfaces/ui/web/console/chat/_legacy/Transcript.premium.jsx` — removed via `git rm -r`
  (superseded by `components/transcript/Transcript.jsx`; the premium variant content is
  preserved on the `ui/rebuild-premium` branch, which is retained).

## 5. Orphaned files removed (0)

- `*.bak`, `*.old`, `Planner.js.bak`, `package-lock.json` backups: `git ls-files` grep → none tracked. Nothing to remove.

## 6. Final state

- Working tree: clean (`git status --short` empty), reset to `origin/main`.
- Remote branches after cleanup: 56 (was 66; 10 merged branches deleted).
- Tags after cleanup: 455 (was 618; 163 stale baselines deleted).
