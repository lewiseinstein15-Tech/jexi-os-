/**
 * JEXI OS — Phase 23 Scope C — ralph diagnostics: mid-loop context injection.
 *
 * A Ralph loop can lose the plot mid-flight: a retry storm, a long tool
 * trace, a context window that dropped the constraint that mattered. This
 * module lets the loop (or its supervisor) inject context INTO a running
 * loop and retrieve it, in injection order:
 *
 *   inject(loopId, { context }) -> { injectedAt }   // the op-seq stamp
 *   get(loopId)                 -> [{ context, injectedAt }]
 *
 * OP-SEQ, NOT CLOCKS
 * injectedAt is an operation sequence number — a counter that starts at 1
 * per add-context instance and increments on every inject across ALL
 * loopIds of that instance. No Date.now(), no hrtime: the same sequence of
 * inject calls produces the same stamps in every run, which is what makes
 * probes and cross-verification byte-comparable.
 *
 * Isolation: createAddContext() builds a private instance (counter starts
 * at 1). The module also exports one default shared instance `addContext`
 * for the contract call style addContext.inject(loopId, { context }).
 * Entries of one loopId are invisible to every other loopId; an unknown
 * loopId reads as [] — empty, not an error (asking is not a violation).
 *
 * The ONLY throws are caller mistakes: non-empty loopId string, `context`
 * present (any value, including null — absence is the mistake),
 * E_INVALID_ARGUMENT via SemanticaError (read-only reuse; no new class).
 */

import { SemanticaError } from '../../../services/semantica/_internal.js';

/**
 * Build an isolated add-context instance with its own op-seq counter.
 */
export function createAddContext() {
  let opSeq = 0;
  /** Map<loopId, Array<{ context, injectedAt }>> — insertion-ordered. */
  const byLoop = new Map();

  return {
    /**
     * Inject context into a loop. Returns { injectedAt: <op-seq> }.
     * The same context object may be injected repeatedly — each injection
     * is a distinct event with its own op-seq stamp.
     */
    inject(loopId, { context } = {}) {
      if (typeof loopId !== 'string' || loopId.trim() === '') {
        throw new SemanticaError('E_INVALID_ARGUMENT', `loopId must be a non-empty string, got ${JSON.stringify(loopId)}`);
      }
      if (arguments.length < 2 || arguments[1] === undefined || arguments[1] === null || typeof arguments[1] !== 'object') {
        throw new SemanticaError('E_INVALID_ARGUMENT', 'inject expects a props bag: inject(loopId, { context })');
      }
      if (context === undefined) {
        throw new SemanticaError('E_INVALID_ARGUMENT', 'context is required (pass null explicitly to inject a null marker)');
      }
      opSeq += 1;
      const entry = { context, injectedAt: opSeq };
      const list = byLoop.get(loopId);
      if (list) list.push(entry);
      else byLoop.set(loopId, [entry]);
      return { injectedAt: opSeq };
    },

    /** Entries for loopId in injection order; [] for an unknown loopId. */
    get(loopId) {
      const list = byLoop.get(loopId);
      return list ? [...list] : [];
    },

    /** Current op-seq counter (stamps issued so far by this instance). */
    currentOpSeq() {
      return opSeq;
    },

    /** Loop ids that hold injected context, in first-injection order. */
    loops() {
      return [...byLoop.keys()];
    },
  };
}

/** Default shared instance — the contract call style: addContext.inject(...). */
export const addContext = createAddContext();
