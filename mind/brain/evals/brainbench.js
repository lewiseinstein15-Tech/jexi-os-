/** JEXI OS — Phase 28 Scope K — injected-retrieval BrainBench harness. */
import { SemanticaError } from '../../../services/semantica/_internal.js';
import { loadCorpus } from './corpus.js';
import { metricsAtK } from './metrics.js';

export const RETRIEVAL_EVAL_LABEL =
  'BrainBench retrieval fixture — NOT end-to-end QA; NOT real-world performance';

const clone = (value) => JSON.parse(JSON.stringify(value));

function resultIds(result) {
  const rows = Array.isArray(result)
    ? result
    : Array.isArray(result?.results)
      ? result.results
      : Array.isArray(result?.ids) ? result.ids : null;
  if (!rows) {
    throw new SemanticaError('E_BACKEND_CONTRACT',
      'retrieval must return an array, { results: [] }, or { ids: [] }');
  }
  return rows.map((row, index) => {
    const id = typeof row === 'string' ? row : row?.id ?? row?.docId ?? row?.doc_id ?? row?.pageId ?? row?.page_id;
    if (typeof id !== 'string' || id === '') {
      throw new SemanticaError('E_BACKEND_CONTRACT', `retrieval result ${index} has no document id`);
    }
    return id;
  });
}

/**
 * Macro-average p@5 and r@5 over declared queries. The retriever sees query
 * id/text and public documents, never the sealed relevant-id labels.
 */
export async function bench({ corpus, retrieval } = {}) {
  if (typeof retrieval !== 'function') {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'bench requires an injected retrieval function');
  }
  const fixture = loadCorpus(corpus);
  const k = 5;
  // Explicit enumeration seals fixture metadata / qrels from the retriever.
  const publicDocs = fixture.docs.map((doc) => ({
    id: doc.id,
    title: typeof doc.title === 'string' ? doc.title : doc.id,
    text: doc.text,
  }));
  const perQuery = [];
  for (const query of fixture.queries) {
    const publicQuery = { id: query.id, text: query.text };
    const raw = await retrieval(clone(publicQuery), { docs: clone(publicDocs), k });
    const ranked = resultIds(raw);
    const score = metricsAtK(ranked, query.relevant, k);
    perQuery.push({
      queryId: query.id,
      query: query.text,
      relevant: [...query.relevant],
      retrieved: ranked.slice(0, k),
      hits: score.hits,
      p5: score.precision,
      r5: score.recall,
    });
  }
  const mean = (key) => perQuery.reduce((sum, row) => sum + row[key], 0) / perQuery.length;
  return {
    label: RETRIEVAL_EVAL_LABEL,
    fixture: true,
    p5: mean('p5'),
    r5: mean('r5'),
    perQuery,
  };
}
