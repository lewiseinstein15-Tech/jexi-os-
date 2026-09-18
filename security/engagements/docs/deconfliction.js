/**
 * JEXI OS — Phase 8 Scope D — DOCUMENT 3/8: DECONFLICTION.
 *
 * Decepticon Soundwave: "Deconfliction: blue-team coordination windows."
 * The bundle section carries the contacts (who) and the windows (when the
 * blue team expects activity). The contact card itself is DOCUMENT 6.
 */

import { EngagementValidationError } from '../store.js';

export const DOC_ID = 'deconfliction';
export const DOC_TITLE = 'Deconfliction';

export function build(draft) {
  if (!draft || typeof draft !== 'object') {
    throw new EngagementValidationError('draft', `${DOC_ID}: expected a plan draft object`);
  }
  const contacts = draft.contacts || [];
  if (!Array.isArray(contacts)) {
    throw new EngagementValidationError('contacts', `${DOC_ID}: contacts must be an array`);
  }
  for (const c of contacts) {
    if (!c || typeof c.name !== 'string' || !c.name.trim() || typeof c.role !== 'string' || !c.role.trim()) {
      throw new EngagementValidationError('contacts', `${DOC_ID}: every contact needs name and role — got ${JSON.stringify(c)}`);
    }
  }
  const windows = draft.coordinationWindows || [];
  if (!Array.isArray(windows)) {
    throw new EngagementValidationError('coordinationWindows', `${DOC_ID}: coordinationWindows must be an array`);
  }
  for (const w of windows) {
    if (!w || !w.start || !w.end || Number.isNaN(new Date(w.start).getTime()) || Number.isNaN(new Date(w.end).getTime())) {
      throw new EngagementValidationError('coordinationWindows', `${DOC_ID}: every coordination window needs parseable start and end — got ${JSON.stringify(w)}`);
    }
  }
  return {
    deconfliction: {
      contacts: contacts.map((c) => ({ name: c.name, email: c.email ?? null, role: c.role })),
      coordinationWindows: windows.map((w) => ({ start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString() })),
    },
  };
}

export default { DOC_ID, DOC_TITLE, build };
