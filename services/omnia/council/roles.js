/**
 * JEXI OS — Phase 15 Scope C — council roles.
 *
 * Roles are declared at convene time and validated against this
 * table. Unknown role -> E_UNKNOWN_ROLE.
 */
import { fail } from '../../semantica/_internal.js';

export const COUNCIL_ROLES = {
  chair: { name: 'chair', duty: 'rules on the outcome, breaks deliberation deadlocks' },
  skeptic: { name: 'skeptic', duty: 'attacks the proposal, surfaces risks' },
  builder: { name: 'builder', duty: 'defends feasibility, costs the proposal' },
};

export function assertRole(role) {
  if (typeof role !== 'string' || !(role in COUNCIL_ROLES)) {
    throw fail('E_UNKNOWN_ROLE', 'unknown council role: ' + JSON.stringify(role) + ' (known: ' + Object.keys(COUNCIL_ROLES).sort().join(', ') + ')');
  }
  return COUNCIL_ROLES[role];
}
