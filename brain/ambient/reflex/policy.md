---
name: retrieval-reflex
version: 1.0.0
description: Deterministic retrieve-before-relying policy for salient entities.
mutating: false
zero_llm: true
max_pointers: 8
---

# Retrieval Reflex

## Trigger rule

Emit a compact page pointer only when all of these hold:

1. A known capitalized entity name or `@handle` occurs in the current turn.
2. The turn is substantive under this exact gate: it has at least six Unicode
   word tokens **and** either a question mark or one of these intent terms:
   `about`, `compare`, `decide`, `review`, `explain`, `tell`, `status`,
   `history`, `relationship`, `plan`, `work`, `before`, `after`, `because`,
   `should`, `need`, `discuss`, `evaluate`, `verify`, `remember`, `prepare`,
   `research`, `meeting`, `decision`, or `context`.
3. The whole trimmed turn is not a greeting/FYI/CC/ping/thanks/noted/okay plus
   at most one entity or handle.
4. The entity is not already loaded. "Loaded" means an exact lower-cased name
   or slug in `loadedSlugs`, `loadedEntities`, `entities`, `cards`, `pointers`,
   or `pack.cards`, or that name/slug occurring in `contextText`/`loadedText`.
5. The page is world-visible, unless the caller explicitly opts into private
   context with `includePrivate: true`.

Pointer extraction is zero-LLM, deterministic, fail-open, and capped at eight
pointers per turn. Every pointer contains name, slug, a one-line summary, and:

> Open the page before relying on details.

## Escalation ladder

Escalate only as far as the task needs:

1. **Pointer:** name, slug, and one-line summary. Stop here for identity-only
   tasks.
2. **Full page:** open the page when details, status, attribution, or history
   matter. Read it before making non-trivial claims.
3. **Graph neighbors:** use Scope C typed edges only when relationship context
   is needed. Pull inbound and outbound neighbors; do not bulk-load the graph.

Use judgment first. Resolve only entities that can improve the current answer,
then drop them from working context when the task is complete.
