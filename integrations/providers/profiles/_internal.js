/**
 * JEXI OS — Phase 27 Scope D — profiles internals.
 *
 * Same error-helper pattern as providers/routing/_internal.js and
 * session/fleet/_internal.js (Phase 27 consistency): typed E_* codes,
 * no dependencies beyond Node stdlib.
 */
export class ProfilesError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProfilesError';
    this.code = code;
  }
}
