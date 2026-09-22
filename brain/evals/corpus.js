/**
 * JEXI OS — Phase 28 Scope K — declared synthetic retrieval fixture.
 * This tiny corpus is not the external 240-page BrainBench corpus and its
 * scores must never be presented as real-world or published BrainBench results.
 */
import fs from 'node:fs';
import { SemanticaError } from '../../semantica/_internal.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

export const FIXTURE_CORPUS = Object.freeze({
  label: 'DECLARED FIXTURE — retrieval eval only; NOT real-world performance',
  fixture: true,
  docs: [
    { id: 'doc-alice', title: 'Alice Example', text: 'Alice founded Acme Labs and advises its analytics team.' },
    { id: 'doc-acme', title: 'Acme Labs', text: 'Acme Labs builds analytical engines with Alice Example.' },
    { id: 'doc-fund', title: 'Northstar Fund', text: 'Northstar Fund invested in Acme Labs during its seed round.' },
    { id: 'doc-graph', title: 'Typed Graph Retrieval', text: 'Typed edges resolve founded, invested, and advised relationships.' },
    { id: 'doc-index', title: 'Hybrid Index', text: 'Keyword and vector rankings are fused before graph signals.' },
    { id: 'doc-timeline', title: 'Evidence Timeline', text: 'Timelines retain append-only dated evidence.' },
    { id: 'doc-budget', title: 'Retrieval Budget', text: 'A fixed top-k budget limits admitted context.' },
    { id: 'doc-orphans', title: 'Orphan Audit', text: 'Orphan pages have no inbound or outbound typed edges.' },
    { id: 'doc-private', title: 'Privacy Boundary', text: 'Private material is never emitted by publishing.' },
    { id: 'doc-noise', title: 'Unrelated Operations', text: 'This distractor discusses deployment operations.' },
  ],
  queries: [
    { id: 'q-founder', text: 'Who founded Acme Labs?', relevant: ['doc-alice', 'doc-acme'] },
    { id: 'q-investor', text: 'Which fund invested in Acme Labs?', relevant: ['doc-fund'] },
    { id: 'q-retrieval', text: 'How does graph-aware hybrid retrieval work?', relevant: ['doc-graph', 'doc-index'] },
    { id: 'q-timeline', text: 'Where is dated evidence retained?', relevant: ['doc-timeline'] },
  ],
});

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SemanticaError('E_INVALID_ARGUMENT', `${field} must be a non-empty string`);
  }
  return value;
}

export function validateCorpus(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'corpus must be an object');
  }
  if (!Array.isArray(input.docs) || !Array.isArray(input.queries)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'corpus must contain docs[] and queries[]');
  }
  if (input.docs.length === 0 || input.queries.length === 0) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'corpus docs[] and queries[] must both be non-empty');
  }
  const corpus = clone(input);
  const docIds = new Set();
  for (const [index, doc] of corpus.docs.entries()) {
    if (!doc || typeof doc !== 'object') throw new SemanticaError('E_INVALID_ARGUMENT', `docs[${index}] must be an object`);
    const id = nonEmpty(doc.id, `docs[${index}].id`);
    if (docIds.has(id)) throw new SemanticaError('E_INVALID_ARGUMENT', `duplicate document id ${JSON.stringify(id)}`);
    docIds.add(id);
    nonEmpty(doc.text, `docs[${index}].text`);
  }
  const queryIds = new Set();
  for (const [index, query] of corpus.queries.entries()) {
    if (!query || typeof query !== 'object') throw new SemanticaError('E_INVALID_ARGUMENT', `queries[${index}] must be an object`);
    const id = nonEmpty(query.id, `queries[${index}].id`);
    if (queryIds.has(id)) throw new SemanticaError('E_INVALID_ARGUMENT', `duplicate query id ${JSON.stringify(id)}`);
    queryIds.add(id);
    nonEmpty(query.text, `queries[${index}].text`);
    if (!Array.isArray(query.relevant) || query.relevant.length === 0) {
      throw new SemanticaError('E_INVALID_ARGUMENT', `queries[${index}].relevant must be a non-empty document-id list`);
    }
    const unique = new Set();
    for (const relevantId of query.relevant) {
      nonEmpty(relevantId, `queries[${index}].relevant[]`);
      if (!docIds.has(relevantId)) {
        throw new SemanticaError('E_INVALID_ARGUMENT', `query ${id} references unknown document ${JSON.stringify(relevantId)}`);
      }
      unique.add(relevantId);
    }
    query.relevant = [...unique];
  }
  // Every accepted corpus is explicitly treated as a fixture. The evaluator
  // makes no claim about production or real-world retrieval performance.
  corpus.fixture = true;
  corpus.label = typeof corpus.label === 'string' && corpus.label !== ''
    ? corpus.label
    : 'DECLARED FIXTURE — retrieval eval only; NOT real-world performance';
  corpus.disclaimer = 'Declared retrieval fixture; not end-to-end QA and not real-world performance.';
  return corpus;
}

/** Load the declared fixture, a corpus object, or a JSON fixture path. */
export function loadCorpus(input = FIXTURE_CORPUS) {
  if (typeof input === 'string') {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(input, 'utf8')); }
    catch (error) {
      throw new SemanticaError('E_INVALID_ARGUMENT', `unable to load corpus ${JSON.stringify(input)}: ${error.message}`);
    }
    return validateCorpus(parsed);
  }
  return validateCorpus(input);
}

export const corpus = FIXTURE_CORPUS;
