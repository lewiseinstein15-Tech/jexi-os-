# B202 — Ranked-List Anti-Hallucination + Domain False-Positive Fixes

**Date:** 2026-09-03 · **Found by:** production smoke test on the live Render deploy

## The bug

The production smoke test asked the live brain (jexi-brain-image.onrender.com):

> "In one short paragraph: what are the three largest lakes in Africa by area?"

It answered in 7.2s via the `direct_answer` fast path — and **hallucinated**:

> 1. Lake Victoria - 36,800 km² ✓
> 2. Lake Tanganyika - 31,700 km² ✓
> 3. **Lake Superior - 27,300 km² ✗ (a NORTH AMERICAN lake)**

The real #3 is Lake Malawi (~29,500 km²). Exactly the failure class the
long-task testing was hunting: confident, fast, wrong — with no sources and
no fact-check because the fast path skips them.

## Root causes (two routing bugs)

1. **Ranked-list questions took the direct-recall fast path.** "What are the
   N largest X" looks like a simple factual question to the planner (8.95
   direct_answer) and to the live-key LLM classifier — but top-N lists with
   quantities are where raw model recall reliably hallucinates members and
   numbers. They are research-shaped: they need sources + fact-check.
2. **Domain keyword false positives.** Even the deterministic cascade
   mis-routed this question — `domain:machine-learning` — because the ML
   regex contained the unanchored token `rag`, which matched "pa**rag**raph".
   The quantum-information regex matched the same question via `shor`
   ("**shor**t"). Sibling unanchored tokens: `shap` (matches "shape"),
   `lime` (matches the fruit), `gan`, `auc`, `cnn`, `rnn`, `pca`, `llm`,
   `grover`, `chsh`, `bb84`, `e91`.

## The fix

**Planner.js**
- New `isRankedListQuestion(q)`: a rank cue (`largest|longest|biggest|highest|
  deepest|tallest|…|top N|N largest`) **and** a list noun (`lakes|rivers|
  mountains|cities|countries|…`) → ranked list.
- New rule **8.75** (before domain/field routing so nothing swallows it):
  ranked lists → `research` with the sourced pipeline team.
- **LLM-path defer** (B199e pattern): if the live-key classifier says
  `direct_answer` but the question is a ranked list → overridden to
  `research`.

**DomainRegistry.js**
- Word-bounded the short ambiguous tokens (`\brag\b`, `\bshor\b`, `\bshap\b`,
  `\bauc\b`, `\bgan\b`, `\bcnn\b`, `\brnn\b`, `\bpca\b`, `\bllm\b`,
  `\bgrover\b`, `\bchsh\b`, `\bbb84\b`, `\be91\b`).
- `lime` → qualified (`lime (explainer|values|interpret)`) so a dying lime
  tree is gardening, not ML.

**Test:** `server/test-b202.js` — 23 checks: cascade routing, LLM defer,
false positives gone, genuine domain matches survive (RAG pipeline, SHAP
values, ROC AUC, Shor's algorithm), and unit checks on the helper.

## Result

- `test-b202.js`: **23/23 passed**
- Full `npm test` chain: **SUITE_EXIT=0** (B197, B200, B201, B202 all green)
- Committed and pushed; CI + Render deploy followed.

## Effect in production

The same question now routes to the research pipeline: web sources are
fetched, the answer is fact-checked, and "Lake Superior" cannot survive
because the lakes are verified against sources rather than recalled.
