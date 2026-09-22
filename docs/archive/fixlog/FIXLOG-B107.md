# FIXLOG-B107 — Skills Marketplace (one-tap installable skills)

**Phase:** B107 · **Shipped:** 2026-08-17 · **Branch:** main (direct) · **CI:** green · **APK:** rebuilt

## Why
Skills are JEXI's superpower (B98 made them auto-discoverable files; the app can even
author them). The missing piece was a curated catalog the user can browse and install
in one tap — a marketplace that feeds straight into discovery.

## What was built

### `server/src/services/SkillMarketplace.js` (new)
- **11 curated skills** (each a real SKILL.md + optional reference.md): meeting-notes,
  code-review, travel-planner, research-synthesis, study-guide, email-draft,
  bug-report, release-notes, data-clean, api-design, retro-notes.
- `listMarketplace()` — catalog with installed state + tags; `installSkill(name)` →
  writes to `DATA_DIR/skills/<name>/` (user root, rank 400) → **instantly
  auto-discovered by B98** and loadable in chat via `skill-load`; `uninstallSkill(name)`
  — path-safe delete; `marketplaceStats()`; `validateMarketplace()` catalog lint.

### API + frontend
- `GET /api/skills/marketplace` · `POST /api/skills/marketplace/:name/install` ·
  `DELETE /api/skills/marketplace/:name` (key-gated like the other skill routes).
- **SkillsScreen third tab: MARKETPLACE (installed/total)** — each card shows
  description, when-to-use, tags, INSTALL / UNINSTALL / USE IN CHAT; installing
  refreshes the DISCOVERED tab live.

### Tests & fixes
- **`test-marketplace.js` — 42 checks**: catalog validity (kebab names, descriptions,
  bodies, no duplicates), listing/stats, install → file on disk → auto-discovered at
  rank 400 → progressive body + reference → `skill-load` through the gate, re-install
  idempotence, unknown-name and path-traversal failures, uninstall → discovery drops
  it, batch installs, registry untouched (191). **42/42 green.**
- Fixed the API-surface checker's URL extraction (the frontend now builds install /
  uninstall URLs as two explicit shapes — 82 endpoints, 0 missing).
- **Full 48-suite sweep exit 0; lint 0 errors.**

## Verification
- `npm test` full sweep: **exit 0** · `eslint`: **0 errors**
- test-api-surface: 82 frontend endpoints ↔ server routes, 0 missing
- APK rebuilt (frontend changed) → release tag bumped.

## How the user sees it
Skills → MARKETPLACE: browse 11 ready-made skills, tap INSTALL, and it's live — visible
in DISCOVERED, loadable in chat ("use the meeting-notes skill"), and usable by JEXI
herself via skill-load. UNINSTALL removes it cleanly.
