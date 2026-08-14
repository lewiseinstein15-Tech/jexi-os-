# Tool Selection — authoritative decision table (B51 P3)

The single source of truth for WHEN to use which tool. Load this folder
(`knowledge-load tools`) on any tool-using turn. Default: the cheapest correct
tool wins — web and browser are never the default.

## Decision table

| Situation | Preferred tools | Do NOT use |
|---|---|---|
| Simple definition / "what is X" | Model knowledge, optional `knowledge-load` / memory-recall | Web search, browser, full Trusted Library study |
| User's own books / uploaded material | knowledge-recall / books | Web |
| Latest news / current events | news or web search | Memory-only |
| Code that must run | code-run, terminal, code-fix | Web |
| Link the user pasted | browser / link analysis (video → transcript + frames) | Generic web search first |
| Deep multi-source research | search + browser + synthesizer | Single model answer only |
| Math / pure reasoning | model + formatting knowledge | Web |
| Project conventions / architecture | knowledge-load (conventions, architecture) | Web |
| Identity / greetings / small talk | answer directly | Any tool |
| Study / "teach me X" / "master X" | Trusted Library deep study (explicit request only) | Study for one-line definitional questions |

## Tool discipline rules

1. Do not browse or search the web for questions you can answer accurately
   from knowledge or project knowledge.
2. Do not launch a full research/study pipeline for a one-line definitional
   question ("what is X" → direct answer; "study X for my exam" → study).
3. Prefer the cheapest correct tool.
4. Every tool call must be justified by the current intent — if the intent is
   `direct_answer` / `conversation`, the tool set is empty (or memory-only).
5. Web/browser are added to a plan ONLY when the intent or the user's explicit
   language requires external or current information (research, news, a pasted
   link, latest prices, current events).
