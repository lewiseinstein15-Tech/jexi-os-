# B203 — Small-Host Memory Hardening (Render free-tier OOM kill)

**Date:** 2026-09-03 · **Found by:** production smoke test, second incident

## The incident

After B202 shipped and the lakes question correctly routed to `research` in
production, the research run **froze and killed the whole brain process**
mid-request. Telemetry from the instrumented run:

```
 2.1s  Query Analyzer starts
40.3s  decomposed into 3 focused sub-searches
62.5s  "Whole-internet scan done — 21 sources from 3 engines"
62.5s  "Re-ranked — keeping the 10 most relevant"
62.5s  "Deep-reading 10 sources in parallel..."
~71s   /api/metrics stops responding (20s timeouts)  ← event loop frozen
134s   stream ends with NO done event                   ← process dead
       → 503 during Render's container restart
```

Even the trivial `/api/metrics` endpoint timed out — the signature of heap
exhaustion (GC death spiral), not an exception. The container restarted.

## Root cause

The math on the Render free tier (512MB container):

- Idle brain baseline: **~240MB RSS** (252 agents, roster, skills, profiles)
- `fetchHTML` had **no download cap** — a 20MB page was fully materialized
- JSDOM+Readability ran on pages up to **2.5MB** (easily 100-200MB peak per
  parse) with **2 concurrent readers**
- 240 + 2×~150MB > 512MB → OOM kill mid-request

Local testing never caught it: the sandbox has more RAM, and quota-dead
providers made earlier runs short-circuit before the heavy path.

## The fix (extraction layer, `Extractor.js` + `SearchAgent.js` + `index.js`)

1. **`readCapped`** — response bodies are never read unbounded: HTML pages
   cap at **768KB** (streaming read + cancel), on the direct fetch AND the
   allorigins proxy fallback.
2. **JSDOM threshold 2.5MB → 300KB** — bigger pages take the light
   regex-based html-to-text path (with an RSS guard: skip JSDOM entirely
   above 330MB RSS).
3. **`capArrayBuffer`** — PDF downloads cap at 8MB.
4. **Deep reads serialized** — `MAX_CONCURRENT_READS` 2 → 1; peak memory
   stays flat, 10 sources still deep-read in a few seconds each.
5. **`/api/metrics` now reports `memory.rssMb / heapUsedMb / heapTotalMb`** —
   future OOM incidents are diagnosable from outside.
6. `extractFromHTML(html, url)` split out of `extractContent` so the
   JSDOM-vs-light-path decision is unit-testable without network.

**Test:** `server/test-b203.js` — 17 checks: capped constants, streamed-body
capping (3MB → 768KB), runaway-reader defense, PDF capping, big-page light
path, small-page Readability path, memory gauges present.

## Result

- `test-b203.js`: **17/17 passed**
- Full `npm test`: **SUITE_EXIT=0** (B197→B203 all green)
- Production research pipeline survives the 512MB ceiling and completes with
  a `done` event (verified post-deploy).

## Effect in production

The lakes question now runs the full research pipeline — sources found,
pages deep-read within memory bounds, synthesized, fact-checked — and returns
a cited answer instead of killing the server.
