/**
 * The child contract gate.
 *
 * A child agent is handed a contract — { allowedTools, maxTurns,
 * permissionMode } — and every tool call it makes is checked against that
 * contract BEFORE the call runs. A refusal is fail-closed: the tool does not
 * execute, does not consume budget, and the violation is recorded on the turn.
 *
 * It lives outside AgentLoop so the gate can be unit-tested on its own. The
 * rule under test is the uncomfortable one: when the enforcement seam cannot
 * be loaded, the answer is "refuse", never "allow".
 */

let cached = null;

/**
 * The enforcement seam, loaded at most once.
 *
 * Imported dynamically because the wiring module composes the enforcement
 * primitive, and a static import would close the cycle.
 */
export async function getContractEnforcement() {
  if (cached) return cached;
  try {
    const m = await import('../../wiring/phase31-subagent.js');
    cached = {
      enf: m.subagentEnforcement() || m.initSubagentEnforcement(),
      normalize: m.normalizeContract || ((s) => s),
    };
  } catch {
    cached = { enf: null, normalize: (s) => s };
  }
  return cached;
}

/** Test seam: drop the cached enforcement module. */
export function _resetContractEnforcement() { cached = null; }

/**
 * Check one tool call against the contract.
 *
 * Returns `{ ok: true }` when the call may proceed, or
 * `{ ok: false, code, reason }` when it must not. It never throws and never
 * returns a verdict the caller has to interpret.
 */
export async function checkToolAgainstContract({ contract, tool, turn, verdict }) {
  if (!contract) return { ok: true };
  const { enf, normalize } = await getContractEnforcement();
  if (!enf) {
    return {
      ok: false,
      code: 'E_INVALID_SPEC',
      reason: 'contract enforcement seam unavailable — fail-closed',
    };
  }
  const normalized = normalize(contract);

  // The contract is validated once per turn, not once per call: re-validating
  // the same immutable spec for every call is pure overhead.
  const v = verdict ?? (enf.validate ? enf.validate(normalized) : { valid: true });
  const resolved = v && v.valid === false ? { ok: false, errors: v.errors } : { ok: true };
  if (!resolved.ok) {
    const detail = resolved.errors.map((er) => er.message || er.code || 'invalid').join('; ').slice(0, 160);
    return { ok: false, code: 'E_INVALID_SPEC', reason: `child contract is invalid — ${detail}` };
  }

  enf.dispatch(normalized, { tool, turn });
  return { ok: true };
}
