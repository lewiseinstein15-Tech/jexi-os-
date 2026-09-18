/**
 * JEXI OS — Phase 8 Scope D — DOCUMENT 6/8: CONTACT (who to call, when).
 *
 * Decepticon Soundwave: "Contact: who to call, when." This document is the
 * operator's comms card, DERIVED from the assembled bundle: primary
 * contact, coordination windows, and the abort escalation chain in one
 * place. It is rendered into the OPPLAN (see bundle.js) — the machine
 * contract stays the deconfliction/abort sections it derives from.
 */

export const DOC_ID = 'contact';
export const DOC_TITLE = 'Contact — who to call, when';

/**
 * @param {object} partial — the bundle assembled so far (needs deconfliction + abort)
 */
export function build(partial) {
  const dec = (partial && partial.deconfliction) || {};
  const abort = (partial && partial.abort) || {};
  const contacts = dec.contacts || [];
  return {
    contact: {
      primary: contacts[0] || null,
      all: contacts,
      when: {
        coordinationWindows: dec.coordinationWindows || [],
        instruction: 'call the primary contact inside every coordination window before and after activity; outside windows, only abort and violation notifications',
      },
      escalationChain: abort.escalation || [],
    },
  };
}

export default { DOC_ID, DOC_TITLE, build };
