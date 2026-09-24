/**
 * JEXI OS — Phase 27 Scope C — routing internals.
 *
 * Same FleetError-style pattern as session/fleet/_internal.js (Phase 27
 * consistency): typed E_* codes, no dependencies beyond Node stdlib.
 */
export class RoutingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RoutingError';
    this.code = code;
  }
}
