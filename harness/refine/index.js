import path from 'node:path';
import { createState } from '../state/index.js';
import { plan } from './planner.js';
import { apply } from './applier.js';
import { rollback as restore } from './rollback.js';
export function createRefine({ state = createState(), directory = path.join(path.dirname(state.journal.path), 'refinements'), trajectoryDirectory = path.resolve('.state/trajectories'), snapshotWriter } = {}) {
  const options = { state, directory, trajectoryDirectory, snapshotWriter };
  return {
    run(trajectoryId) { return apply(plan(trajectoryId, options), { ...options, trajectoryId }); },
    rollback(snapshotId) { return restore(snapshotId, options); },
  };
}
export function run(trajectoryId) { return createRefine().run(trajectoryId); }
export function rollback(snapshotId) { return createRefine().rollback(snapshotId); }
export default { run, rollback };
