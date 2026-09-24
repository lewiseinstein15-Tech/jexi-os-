/**
 * JEXI OS — Phase 28 Scope F — hot-memory fact taxonomy.
 *
 * EXACTLY five kinds. Changing this list or its meaning is a semantic change.
 */
import { SemanticaError } from '../../../services/semantica/_internal.js';

export const FACT_KINDS = Object.freeze([
  'event',
  'preference',
  'commitment',
  'belief',
  'fact',
]);

const KIND_SET = new Set(FACT_KINDS);

export function isFactKind(kind) {
  return KIND_SET.has(kind);
}

export function assertFactKind(kind) {
  if (!isFactKind(kind)) {
    throw new SemanticaError('E_INVALID_ARGUMENT',
      `unknown fact kind ${JSON.stringify(kind)}; expected one of: ${FACT_KINDS.join(', ')}`);
  }
  return kind;
}
