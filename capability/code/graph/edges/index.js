// Capability/Code — edge type registry (CBM graph model).
// CALLS, IMPORTS, INHERITS, HTTP_CALLS, CROSS_SERVICE.
import * as calls from './calls.js';
import * as imports from './imports.js';
import * as inherits from './inherits.js';
import * as httpCalls from './http-calls.js';
import * as crossService from './cross-service.js';

export const EDGE_TYPES = {
  CALLS: calls.TYPE,
  IMPORTS: imports.TYPE,
  INHERITS: inherits.TYPE,
  HTTP_CALLS: httpCalls.TYPE,
  CROSS_SERVICE: crossService.TYPE,
};

const BY_TYPE = {
  [calls.TYPE]: calls,
  [imports.TYPE]: imports,
  [inherits.TYPE]: inherits,
  [httpCalls.TYPE]: httpCalls,
  [crossService.TYPE]: crossService,
};

/** Normalized edge record: { type, src, dst, props } (src/dst = node ids). */
export function makeEdge(type, src, dst, props = {}) {
  const mod = BY_TYPE[type];
  if (!mod) throw new Error(`unknown edge type: ${type}`);
  return mod.create(src, dst, props);
}
