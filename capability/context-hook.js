// Phase 11 Scope I — capability/context-hook.js
//
// Shows HOW the graph-first adapter would wire into the context pipeline:
// a context source that answers STRUCTURAL code questions from the Scope A
// knowledge graph instead of reading files, with the token cost stated.
//
// ZONE DISCIPLINE: this module imports NOTHING from server/src/context/**.
// The actual wiring (server/src/context/sources/code.js calling
// answerStructuralQuery) is a RECORDED ZONE-OWNER TASK — not actioned here:
//
//   Zone-owner task (one line): in server/src/context/sources/code.js,
//   replace the file-reading step with
//   `const { answerStructuralQuery } = await import('../../../capability/code/graph-first.js')`
//   and return its { summary, items, tokens } for structural questions.

import { answerStructuralQuery, compare } from './code/graph-first.js';

export const SOURCE_ID = 'capability/code/graph-first';

/**
 * Context-provider shape: question in, injectable context out.
 * Falls back to NOTHING here — honest NOT_IN_GRAPH status is returned and the
 * caller (the future server/src/context wiring) decides what to do.
 */
export async function getContext(question, { project = 'jexi-os' } = {}) {
  const r = await answerStructuralQuery(question, { project });
  return {
    sourceId: SOURCE_ID,
    status: r.status, // 'ok' | 'NOT_IN_GRAPH'
    context: r.summary,
    items: r.items,
    tokens: r.tokens,
    tokenizer: r.tokenizer,
  };
}

/**
 * Context-provider shape with measured fallback: if the graph cannot answer,
 * fall back to real file reads and report what it cost — the number that
 * justifies the graph-first wiring.
 */
export async function getContextWithFallback(question, { project = 'jexi-os' } = {}) {
  const c = await compare(question, { project });
  return {
    sourceId: SOURCE_ID,
    status: c.fallbackToFileRead ? 'NOT_IN_GRAPH_FALLBACK' : 'ok',
    context: c.fallbackToFileRead ? c.files.summary : c.graph.summary,
    items: c.fallbackToFileRead ? c.files.items : c.graph.items,
    source: c.fallbackToFileRead ? 'files' : 'graph',
    tokens: c.fallbackToFileRead ? c.files.tokens : c.graph.tokens,
    tokensIfFilesWereRead: c.files.tokens,
    tokensSaved: c.fallbackToFileRead ? 0 : c.files.tokens - c.graph.tokens,
    ratio: c.ratio,
    tokenizer: c.tokenizer,
  };
}

export { answerStructuralQuery, compare };
