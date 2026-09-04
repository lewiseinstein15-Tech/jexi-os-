# FIXLOG — B213 Method Provenance

**Build:** B213 — employees must not claim methods they never ran.
**Found by:** the B212 live production E2E (replan items claimed
"headless_browser" / "real_browser" that never executed).
**Live-verified:** 2026-09-04, production mission `ms-mtmru4qw-001`.

## The problem

The first live missions showed real-LLM employees (especially on
replan/verification items) describing methods they never executed. Vera's
coherence check caught the contradictions, but a verifier that only sees
the deliverable can in principle be misled by internally-consistent
fabricated evidence — and in one case she trusted a fabricated
"raw_dom_snippet" over the real fetched value.

## The fix (three layers)

1. **Gate 1.6 — deterministic method provenance** (`Verifier.js`):
   `claimsBrowserMethod()` detects affirmative browser-method claims
   (headless/real browser, playwright/puppeteer/selenium, "opened it in
   the browser", JSON `"method": "headless_browser"`), with negation
   guards so honest reporting ("browser unavailable, fetched instead")
   is never punished. A claim with NO `COMPUTER_ACT`/`COMPUTER_OBSERVE`
   event in the task record is a fabricated method → forced fail. The
   model cannot override it (rubric pass is ANDed with the gates).
2. **Grounded rubric** — Vera's prompt now carries
   `executionEvidence(task.events)`: browser actions / blocks with the
   true reason, commands+tests with the last one named, files, searches,
   model calls — plus the instruction that a claim contradicting this
   evidence is fabrication. Verification checks claims against evidence,
   not just internal coherence.
3. **Employee rule** (`EmployeeSession.js` brief): "Report only methods
   you actually executed this session. If a tool was blocked or
   unavailable, say exactly that."

## Proof

- `server/test-b213.js` — 28 checks: claim/negation matrix (including
  the exact fabrication shapes from the live run), the zero-trust proof
  (fabricated method fails EVEN WHEN the model says pass), corroborated
  claims pass, honest fallbacks never flagged, evidence summary shapes,
  prompt grounding, employee brief carries the rule.
- Full `npm test` chain green (B213 chained in as the final suite).
- **Live on production:** the replay mission's employees produced
  correct-looking values from memory with zero tools executed — and Vera
  failed it twice with evidence-grounded verdicts, verbatim:
  - "No browser was invoked and no server-side fetch command was executed."
  - "The deliverable falsely sets 'fallback: false', contradicting the
    execution history where no browser ran."
  - "The deliverable claims the data was obtained via a server-side
    rendering API, but the execution history shows zero commands were
    executed and no network requests were made, indicating the data was
    fabricated."

The system now rejects correct-looking answers without real provenance —
which is the point.

## Honest notes

- Gate 1.6 covers browser-method claims (the highest-stakes kind,
  deterministic). Other method claims ("via an API", "cross-checked with
  source X") rely on the grounded rubric — model-based but now
  evidence-armed. A general provenance ledger (every claim tied to an
  event) is future work if it proves necessary.
- Employees still sometimes answer from memory instead of running tools;
  the difference is the system now catches it deterministically at
  verification instead of hoping the coherence check notices.
- Director lane: **588 checks** (B208 89 · B209 92 · B210 64 · B211 295 ·
  B212 20 · B213 28), all green.
