# FIXLOG B199 — Long-task autonomy hardening (found live, fixed live)

**Date:** 2026-09-03 · **Report:** *"test if Jexi can work on a very long task… autonomously, without problems or hallucinating"*

The test: *"List every one of the 54 countries in Africa — table with capital,
population, year of independence."* A long, verifiable, hallucination-checkable
task. It found **five real bugs** — all fixed with regression tests.

---

## Bug 1 — the books false-positive hijack (answered NOTHING in 2s)

The first run returned in 2.0 seconds with "mission complete", 95% confidence,
8 agents — and a 199-char answer containing **zero countries**. A leftover
JavaScript tips book had "matched" the question because `searchKnowledge`
scored ANY query word: "list", "table", "with", "columns", "year" — ordinary
English present in every text. The books path then hijacked the answer and the
model's honest "this book has nothing on that" reply shipped as the FINAL
answer.

**Fix:** `searchKnowledge` now scores **distinctive terms only** (a stop-word
list covers generic English + programming words; a topical question needs 2
distinctive hits, not 1 stray one), and every books call site bails out to real
research when the reply is an explicit source refusal
(`looksLikeSourceRefusal`).

## Bug 2 — five minutes of work thrown away (the draft clobber)

Run 2 did the REAL work — 30 sources from 6 engines, deep-read 10,
synthesized from 6, fact-check flagged 6 claims, re-entered research — and
then the revise node adopted the re-run's honest
*"I could not find enough information"* sentinel as the new draft, **clobbering
the real 6-source answer**, and shipped 75 chars of failure as
success=True.

**Fix:** the revise node only adopts a re-run that produced a REAL answer
(`isNonAnswerText` guard); a sentinel keeps the existing draft and logs
"shipping the best-effort draft with its caveats". The research node also
falls back to `reasonAndWrite` (her own knowledge + the team's sources,
verified like any draft) when the search team itself returns the sentinel.

## Bug 3 — she remembered failing (memory poisoning)

The failure message got SAVED to `internetKnowledge` — so the next identical
question was answered in 1.3 seconds with "I could not find enough
information…" straight from memory. She had literally memorized her own
failure and refused to retry, forever.

**Fix:** `saveInternetKnowledge` refuses to store non-answers (sentinels,
no-key notices, source refusals) — protecting all five call sites at once;
both recall paths filter non-answers; and `purgeNonAnswerKnowledge()` runs at
boot to self-heal already-poisoned stores (5 entries purged on the test box).

## Bug 4 — every Groq call ate a 404 first (stale model)

Groq retired `llama-3.3-70b-versatile`. The B177 self-heal discovered
`openai/gpt-oss-120b` and cached it — but only the tool-calling path consulted
the cache: every plain completion still OPENED with the dead model, ate a 404,
and only then retried. One wasted round-trip per call, all run long. Gemini's
catalog was equally stale (2.5-flash deprecated, 1.5-flash gone).

**Fix:** `tryGroq` starts from the discovered model; the Gemini catalog leads
with the current generation (`gemini-3.6-flash`).

## Bug 5 — the 14,871-token synthesis (413 → cascade → sentinel)

The synthesizer packed the FULL deep-read text of all 10 sources into one
prompt: 14,871 tokens against Groq's 8,000 TPM free-tier cap → 413 "request
too large" → provider roulette (Gemini quota-dead) → whichever model finally
answered saw a degraded view and honestly returned the sentinel.

**Fix:** `budgetSources()` — the re-ranked top sources keep up to 3,000 chars
each within an 18,000-char total (~≤8K tokens incl. prompts); the tail is
dropped, never the top.

---

## Result (live, third run)

The pipeline now runs the full marathon — question breakdown, multi-engine
scan, parallel deep-read, grounded synthesis, fact-check, targeted re-entry —
without hijacks, without clobbering, without memorizing failures, and without
dead-model round-trips. `generateContent` warm in 0.6s. 25 regression checks
in `server/test-b199.js`.
