/**
 * JEXI OS — Phase 14 Scope D — ontology entry point.
 *
 *   import { ontology } from './semantica/ontology/index.js';
 *   const { ontology: ont } = ontology.declare({ classes, relations });
 *   ont.validate(nodeOrEdge, ctx?)      -> { valid, errors? }
 *   ontology.deduplicate(nodes)         -> { merged, groups }   (plan only)
 *   ontology.applyMerge({nodes,edges}, plan) -> rewritten arrays
 */
import { Ontology, declare } from './ontology.js';
import { validate } from './validate.js';
import { deduplicate, applyMerge, normalizeLabel } from './deduplicate.js';

Ontology.prototype.validate = function (item, ctx) { return validate(this, item, ctx); };
Ontology.prototype.deduplicate = function (nodes) { return deduplicate(nodes); };
Ontology.prototype.applyMerge = function (data, plan) { return applyMerge(data, plan); };

export const ontology = { declare, validate, deduplicate, applyMerge, normalizeLabel, Ontology };
export { Ontology, declare, validate, deduplicate, applyMerge, normalizeLabel };
export { SemanticaError } from '../_internal.js';
