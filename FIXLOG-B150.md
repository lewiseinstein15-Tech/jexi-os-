# FIXLOG B150 — speed (DSH-style token streaming), composer always visible, + button placement

**Date:** 2026-08-19 · **Repo:** lewiseinstein15-Tech/jexi-os- · **Branch:** main

User feedback: long messages couldn't scroll and the type button disappeared;
the + (photo/file) button should sit ABOVE the input bar on the left (not
inside it); the app felt very slow — "check how DeepSeek harness does it,
pull every part, make JEXI fast but accurate".

## Speed — the DeepSeek Harness way (token streaming)
DSH's llm runtime exposes `llm/stream` (StreamChunk deltas) and the agent
loop renders the answer as it is generated. JEXI previously waited for the
whole final answer. Now:

- `streamOpenAICompletion` (dsh llm/stream mirror): OpenAI-compatible SSE
  streaming (`stream: true`, `data:` lines, `[DONE]`), accumulating text and
  tool_calls deltas (indexed reconstruction).
- `streamPlainText`: walks the provider chain (Groq REST, OpenRouter,
  DeepSeek, xAI, Cerebras, DeepInfra, Mistral) feeding `onDelta` per chunk.
- `chatWithToolsOnce` streams when `opts.onToken` is set; the agent loop and
  the direct path pass `onToken` through → the chat emits `stream` NDJSON
  events → the frontend renders the answer **typing itself in live**
  (one growing message, replaced by the final summary on `done`).
- Rate limiter 30 → 45 req/min (DSH paces per-call, not per-minute).
- Any streaming failure falls back to the normal path automatically —
  accuracy is never traded for speed.

## Layout fixes
- Composer **always visible**: `flex-shrink: 0` + `min-height: 0` chain +
  `overflow-wrap: anywhere` on messages — very long answers scroll inside
  their own area; the type button + Send stay pinned at the bottom.
- **+ button moved ABOVE the input bar, left-aligned** (small toolbar row);
  the Photo/File menu opens downward from it. Send stays in the bar.

## Verified
- Full suite: 68 suites, exit 0 (fresh clone at the verified remote tip,
  so no leftover-history contamination).
- All frontend files parse (esbuild).
