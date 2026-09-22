/** JEXI OS — Phase 28 Scope K — evaluation public surface. */
import { bench, RETRIEVAL_EVAL_LABEL } from './brainbench.js';
import { loadCorpus, validateCorpus, FIXTURE_CORPUS, corpus } from './corpus.js';
import { precisionAtK, recallAtK, hitsAtK, metricsAtK } from './metrics.js';

export const evals = Object.freeze({
  bench,
  loadCorpus,
  precisionAtK,
  recallAtK,
  metricsAtK,
  label: RETRIEVAL_EVAL_LABEL,
});

export default evals;
export {
  bench, RETRIEVAL_EVAL_LABEL,
  loadCorpus, validateCorpus, FIXTURE_CORPUS, corpus,
  precisionAtK, recallAtK, hitsAtK, metricsAtK,
};
