/**
 * JEXI OS — VERIFICATION — frozen acceptance criteria.
 *
 * Acceptance criteria are fixed BEFORE work starts and never change mid-work.
 * `acceptCriterion(nodeId, text)` stores criteria once per node; a LATER
 * attempt to add or modify criteria for that node returns an error — never a
 * silent update. Evidence records the exact criteria that were in force.
 */

/** @typedef {object} CriterionRecord
 *  @property {string} nodeId
 *  @property {string} text
 *  @property {string} frozenAt */

/** Accept a criterion for a node. @throws when criteria already frozen. */
export function acceptCriterion(nodeId, text, { frozenAt = new Date().toISOString() } = {}) {
  if (!nodeId) throw new Error('nodeId required');
  if (!text?.trim()) throw new Error('criterion text required');
  return { nodeId, text, frozenAt };
}

/** Verify a list of frozen criterion records passed to work graph. */
export function frozenCriteriaFor(nodeId, criteria) {
  return criteria.filter((c) => c.nodeId === nodeId).map((c) => c.text);
}

/**
 * A frozen store keyed by nodeId. Accept once, refuse later modifications.
 */
export function createFrozenCriteriaStore({ now = () => new Date().toISOString() } = {}) {
  const byNode = new Map();

  /** @param {string} nodeId @param {string} text */
  function accept(nodeId, text) {
    if (byNode.has(nodeId)) {
      const err = new Error(`criteria already frozen for node ${nodeId} — modification refused`);
      err.refuses = 'criteria_frozen';
      throw err;
    }
    const rec = acceptCriterion(nodeId, text, { frozenAt: now() });
    byNode.set(nodeId, [rec]);
    return rec;
  }

  /** Attempted modification AFTER freeze → refusal (rule 3). */
  function modify(nodeId, text) {
    if (byNode.has(nodeId)) {
      const err = new Error(`criteria frozen for node ${nodeId} — modification refused`);
      err.refuses = 'criteria_frozen';
      return { ok: false, error: err };
    }
    return { ok: true, record: acceptCriterion(nodeId, text, { frozenAt: now() }) };
  }

  function list(nodeId) {
    return byNode.get(nodeId) ?? [];
  }

  return { accept, modify, list, has: (n) => byNode.has(n) };
}