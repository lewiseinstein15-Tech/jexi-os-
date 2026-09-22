# JEXI OS — Design Decisions Ledger (Phase 31)

Status: **LEDGER ONLY — NO DECISIONS MADE HERE.** This document records open
design decisions flagged across Phase 31 scopes so they are not lost. Nothing
in this file changes behavior; each entry awaits its own authorized scope.

Fields per entry: **What** the decision is, **Why** it is open, **Owner** who
owns resolving it.

---

## 1. PromptAssembly.js section seam

- **What:** Whether to wire a live assembly consumer for `PromptAssembly.js`'s
  canonical sections (`registerCanonical` is currently unconsumed), or keep
  the context-source pipeline as the permanent assembly route.
- **Why open:** Phase 25 shipped the section seam with no live consumer in the
  tree; the Phase 30 Scope D (P30.D) context-source pipeline route works as a
  workaround, so there is no forcing failure — but the seam's real contract is
  unexercised until a consumer exists.
- **Owner:** Phase 25 owner (prompt assembly / server core).

## 2. StrictMode for chat/mount.js

- **What:** Whether `ui/web/chat/mount.js` should wrap its self-owned React
  root in `React.StrictMode` like the rest of the app surfaces.
- **Why open:** The Phase 24 H-fix mounted the chat shell without StrictMode
  because `mount.js` owns its own React root; enabling it double-invokes
  effects in development and needs a dedicated regression pass over the
  mounted shell before it can be turned on.
- **Owner:** Phase 24 owner (chat UI).

## 3. Legacy console retirement

- **What:** When and how to retire the legacy `#classic` executive console
  (12-view surface) in favor of the current console routes.
- **Why open:** The legacy surface still serves and is still referenced;
  retirement is a product-level decision with migration and screenshot/docs
  implications, not a pure code change.
- **Owner:** Product owner + console UI owner.

## 4. Unclassified tool classification default (Phase 16 H)

- **What:** The default classification applied to tools that arrive without an
  explicit classification.
- **Why open:** Phase 16 H deferred choosing the default (fail-closed vs
  fail-open vs prompt-on-first-use); behavior currently rides existing
  defaults and no misclassification incident has forced the choice.
- **Owner:** Phase 16 owner (tool classification / security).

## 5. thinking narrationType

- **What:** Whether `thinking` gets a first-class narration type in the event
  protocol instead of riding in `ctx.guiType`.
- **Why open:** Phase 29 K ships it via `ctx.guiType`, which works but
  overloads the guiType semantics; changing it touches the event contract
  consumed by the UI and needs a coordinated protocol bump.
- **Owner:** Phase 29 owner (narration protocol).

## 6. W16 Phase 12 gates — CodingLoop.js + VerificationLoop.js

- **What:** Whether and how to wire the Phase 12 gates into `CodingLoop.js`
  and `VerificationLoop.js` (both located, neither wired).
- **Why open:** The gate modules are located but no wiring spec has been
  approved; wiring changes loop control flow and needs its own probe design.
- **Owner:** Loop owner (Phase 12/16 lineage) + phase lead.

## 7. S4-MEMFS — memory-fs rule-surface mapping

- **What:** Which rule surface governs the memory filesystem.
- **Why open:** The mapping from memory-fs operations to the rule surface was
  not specified when the memory-fs work shipped; a rule-surface decision must
  precede any wiring.
- **Owner:** Security / rule-surface owner.

## 8. S4-OUTFMT — output-format gate location

- **What:** Where the output-format gate lives.
- **Why open:** The identified consumer (`AgentLoop.js`) sat outside the named
  call sites at diagnosis time, so the gate could not be placed without
  dedicated scope authorization.
- **Owner:** Core loop owner (AgentLoop lineage) + phase lead.

## 9. rank() O(N^2) in Scope 5 repo-map

- **What:** Replacing the O(N^2) `rank()` in the Scope 5 repo-map with a
  scalable algorithm (inverted index or partial sort) for full-repo scans.
- **Why open:** The current bound is intentionally limited to the server tree
  where N is small and latency is fine; a swap needs a benchmark and a design
  pass before it can replace the simple ranking.
- **Owner:** Scope 5 owner (repo-map / search infra).

## 10. Probe runner — 107 phase probes in one flat dir

- **What:** Reorganizing the ~107 phase probes currently sitting flat in
  `scripts/` (per-phase subdirectories, an index, or a selector runner).
- **Why open:** The flat layout works and is referenced by docs and probes;
  any move churns paths and needs a naming + migration plan agreed first.
- **Owner:** Repo hygiene owner + phase lead.
