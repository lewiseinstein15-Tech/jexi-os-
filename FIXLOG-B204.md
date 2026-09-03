# B204 — Research Latency: Overlap + Core-Query + Adaptive Reads

**Date:** 2026-09-03 · **Driver:** the B203 production run was correct but
patient — first answer word at **89.3s**, total 260.4s.

## The breakdown (from prod telemetry)

| Stage | Time | Why |
|---|---|---|
| Query Analyzer (LLM) | 34s | Serial, before ANY search — pure dead time |
| Searches | 22s | 3 sub-queries across 4 engines |
| Deep-read | 31s | Serialized by B203 (concurrency 1) |
| Synthesis → first word | ~0.7s | fine |

The kicker: the lakes question only *looked* complex. "In one short
paragraph: what are the three largest lakes in Africa by area?" is 76 chars —
over the 70-char complexity threshold — but 24 of those characters are
answer-format packaging, not research complexity.

## The fix (SearchAgent.js)

1. **`coreQuery(q)`** — strips leading answer-format packaging
   ("In one short paragraph:", "briefly:", "Please in a short sentence…",
   "in your own words:"…) before complexity scoring. The lakes question's
   core is 51 chars → **simple** → single focused search, no LLM
   decomposition, 34s saved outright.
2. **Overlap** — `searchOne(coreQuery)` starts the *instant* research begins;
   the analyzer's LLM call runs alongside it. For genuinely complex
   questions the decomposition is now free (overlapped with the raw-query
   search, which usually contributes most sources anyway). `mergePools`
   extracted so both paths share the dedupe logic.
3. **`readConcurrency()`** — with B203's memory caps in place (768KB download
   cap, 300KB JSDOM threshold, RSS guard), deep-read runs at concurrency 2
   while RSS < 300MB and falls back to 1 on small/full hosts. Deep-read wall
   time roughly halves on healthy hosts.

**Test:** `server/test-b204.js` — 21 checks: packaging stripped (6 forms),
complexity scored on the core (simple lakes / complex compare), analyzeQuery
simple path instant with no LLM round-trip, mergePools dedupe + null
resilience, adaptive concurrency, source-order wiring of the overlap, and
the B202 regression guard (ranked lists still route to research).

## Result

- `test-b204.js`: **21/21 passed**; full `npm test`: **SUITE_EXIT=0**
- Local: analyzer skip at 2.8s, synthesis starts at **19s** (was 88.6s)
- **Production verified** (same lakes question):
  - "→ simple question — single focused search." at 2.4s
  - **First answer word: 43.8s** (was 89.3s, −51%)
  - **Total: 129.2s** (was 260.4s, −50%) — still runs the full
    fact-check → re-research → re-synthesize → verify loop (32 sources on
    the second round) and ships the honest best-effort answer
  - Answer unchanged and correct: Lake Victoria, Lake Tanganyika,
    **Lake Malawi (Lake Nyasa) ~29,600 km², cited [1][3][5]**

## Notes

- A smoke test hit mid-deploy cutover once (stream dropped at 47s with no
  `done`) — that was Render swapping containers under an in-flight request,
  not a crash. Re-ran clean after the deploy settled.
- Remaining latency is now real work: engine search time, bounded deep
  reads, and the anti-hallucination verify loop — the right things to spend
  time on.
