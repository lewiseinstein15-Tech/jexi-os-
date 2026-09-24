/**
 * JEXI OS — Phase 20 Scope C — consensus registry.
 *
 *   consensus.propose(algo, { value, members, ... }) -> { algo, value, votes, decision, dissent, ... }
 *   consensus.list()                                 -> the five algorithms
 *   consensus.validate(algo, result)                 -> { valid, errors? }
 *
 * Each algorithm's decision rule is real (see the per-file headers):
 * byzantine (3f+1, 2f+1 quorum), raft (leader + majority commit), gossip
 * (rumor convergence), crdt (conflict-free merge), quorum (N of M).
 * Unknown algo -> E_UNKNOWN_ALGO. Same inputs -> byte-identical result.
 *
 * validate() re-runs the algorithm on the result's recorded inputs and
 * compares the recomputed decision and dissent — a result is valid only if
 * the rule genuinely produced it.
 */
import { SwarmError } from './_internal.js';
import byzantine from './byzantine.js';
import consensusCrdt from './crdt.js';
import gossip from './gossip.js';
import quorum from './quorum.js';
import raft from './raft.js';

const ALGOS = new Map([
  [byzantine.ALGO, byzantine],
  [raft.ALGO, raft],
  [gossip.ALGO, gossip],
  [consensusCrdt.ALGO, consensusCrdt],
  [quorum.ALGO, quorum],
]);

/** Knobs each algorithm accepts beyond { value, members, votes }. */
const KNOBS = new Map([
  ['byzantine', ['f']],
  ['raft', ['leader']],
  ['gossip', []],
  ['crdt', ['states']],
  ['quorum', ['threshold']],
]);

export function propose(algo, opts = {}) {
  const entry = ALGOS.get(algo);
  if (!entry) {
    throw new SwarmError('E_UNKNOWN_ALGO', `unknown consensus algorithm "${String(algo)}"; known: ${list().join(', ')}`);
  }
  return entry.propose(opts);
}

export function list() {
  return [...ALGOS.keys()].sort();
}

export function validate(algo, result) {
  const errors = [];
  const push = (m) => errors.push(m);
  if (!ALGOS.has(algo)) {
    return { valid: false, errors: [`unknown consensus algorithm "${String(algo)}"; known: ${list().join(', ')}`] };
  }
  if (!result || typeof result !== 'object') {
    return { valid: false, errors: ['result must be an object'] };
  }
  if (result.algo !== algo) {
    push(`result.algo is ${JSON.stringify(result.algo)}, expected "${algo}"`);
    return { valid: false, errors };
  }
  try {
    const opts = { value: result.value, members: result.members, votes: result.votes };
    for (const knob of KNOBS.get(algo)) {
      if (result[knob] !== undefined) opts[knob] = result[knob];
    }
    const recomputed = ALGOS.get(algo).propose(opts);
    if (JSON.stringify(recomputed.decision) !== JSON.stringify(result.decision)) {
      push(`decision mismatch: rule produces ${JSON.stringify(recomputed.decision)}, result claims ${JSON.stringify(result.decision)}`);
    }
    if (JSON.stringify(recomputed.dissent) !== JSON.stringify(result.dissent)) {
      push(`dissent mismatch: rule produces ${JSON.stringify(recomputed.dissent)}, result claims ${JSON.stringify(result.dissent)}`);
    }
  } catch (err) {
    push(`recomputation failed: ${err.message}`);
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export { SwarmError };
export { byzantine, raft, gossip, quorum };
export { consensusCrdt as crdt };

export default { propose, list, validate };
