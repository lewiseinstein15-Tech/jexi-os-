/**
 * JEXI OS — Phase 19 Scope A — surfsense connector internals.
 *
 * Same FleetError/RoutingError-style pattern as session/fleet/_internal.js and
 * providers/routing/_internal.js (Phase 27 consistency): typed E_* codes,
 * no dependencies beyond Node stdlib.
 */
export class SurfError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SurfError';
    this.code = code;
  }
}
