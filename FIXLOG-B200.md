# FIXLOG B200 — Arena-style streaming: she narrates her work, live

**Date:** 2026-09-03 · **Report:** *"arena agent always updates the user in
every part of what it is doing — that will be next build: the streaming of
what she is doing."*

## What Arena agents do (the pattern we copied)

An arena agent narrates continuously while it works:
1. **First-person intent before each action** — "Let me check the logs…"
2. **The action visibly runs** — tool calls and results stream in
3. **Interpretation after key results** — "Found the bug — now fixing it"
4. **One flowing transcript** — narration, actions, and the final answer in a
   single live-updating view
5. **A closing summary** of what was done

JEXI had the ActionFeed (B184, coworker status lines) — but the answer itself
NEVER streamed: every live run measured **0 stream chars**. The client's B150
stream handler existed with nothing feeding it. Users waited minutes watching
status lines, then got one wall of text.

## What was built

### 1. Narration events — her own words, live
`{type:'narration', text}` — first-person lines emitted at the meaningful
moments of a task, template-generated from real state (counts, engines,
claims) with no extra LLM calls:

- *"I'm on it — let me break this question down first."*
- *"I've split it into 3 focused searches — scanning the web now."*
- *"I found 30 sources across 6 search engines."*
- *"I finished reading — 9 pages gave me real content. Writing the answer now, with citations."*
- *"My first draft looked thin — I'm doing one more in-depth pass."*
- *"Let me fact-check my draft against those sources."*
- *"The fact-check flagged 6 claims — I'm re-verifying those specifically."*
- *"The extra pass came back empty — I'll give you the best-effort answer with honest caveats."*
- *"My sources only partially cover this — I'll answer from my own knowledge and verify that."*

### 2. Answer token streaming — the answer types itself
The search synthesizer (`synthesizeGrounded`) and the knowledge-fallback
writer (`reasonAndWrite`) now thread `onToken` through to the provider SSE
streams, and the research node emits each delta as a `stream` event. The
client's existing B150 handler renders the answer live in the chat.

**No double-append:** only the FIRST synthesis streams; the gap-filler
re-synthesis and the verify-loop re-runs update the final answer in the done
event (one atomic replace, like an arena agent revising its output); the
fallback writer streams only when nothing streamed yet.

### 3. The NarrationFeed — how it renders
A new component in the assistant message, above the answer:

- **While she works** — an open, live panel: `JEXI · WORKING` badge (breathing
  amber), her lines appearing one by one, each with a soft dot, the last line
  pulsing, "working…" tail, auto-scrolled (capped height).
- **When the answer lands** — it collapses to a one-line
  `HOW I WORKED · N steps` disclosure the user can reopen. The story of the
  work stays with the answer, never in its way.

The ThinkRow (reasoning) and ActionFeed (coworker status) remain — three
layers of transparency: what she says she's doing, what she's reasoning, and
what the team is executing.

## Tests — `server/test-b200.js` (16 checks)

Behavioral (graph seams): sentinel re-run preserves the real draft + fires the
empty-pass narration; real re-run still replaces the draft; flagged-claims
narration fires. Static: narration at every key moment; first-synthesis-only
streaming; no double-append in the gap-filler or fallback; engine + chat
wiring. Rendered: live feed shows her lines + WORKING badge; finished feed
collapses to `HOW I WORKED · 3 steps`; empty feed renders nothing.
