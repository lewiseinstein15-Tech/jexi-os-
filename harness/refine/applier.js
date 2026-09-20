import path from 'node:path';
import { canonical, failure } from '../state/journal.js';
import { plan } from './planner.js';
import { current, locked, writeSnapshot, loadSnapshot, commit } from './storage.js';

export function apply(proposal, options) {
  const { state, directory, trajectoryId, trajectoryDirectory, snapshotWriter = writeSnapshot } = options;
  if (/base[\s_-]*prompt|immutable/i.test(String(proposal?.collection))) state.basePrompt.refuse('refine apply');
  if (!proposal?.evidence?.source || !proposal.evidence.detail) throw failure('E_NO_EVIDENCE');
  return locked(state, () => {
    // Re-read the immutable input and current state: reject invented or stale edits.
    const expected = plan(trajectoryId, { state, trajectoryDirectory });
    if (canonical(proposal) !== canonical(expected)) throw failure('E_NO_EVIDENCE', 'Proposal does not match trajectory evidence and minimal edit');
    const before = current(state);
    const payload = { version: 1, store: path.resolve(state.journal.path), state: before, proposal, journalLength: state.journal.read().length };
    let snapshotId;
    try {
      snapshotId = snapshotWriter(directory, payload);
      const saved = loadSnapshot(directory, snapshotId);
      if (canonical(saved) !== canonical(payload)) throw failure('E_NO_SNAPSHOT');
    } catch (cause) { throw Object.assign(failure('E_NO_SNAPSHOT'), { cause }); }
    const previous = state.read(proposal.collection, proposal.id);
    const entry = { ...previous, ...proposal.patch, id: proposal.id };
    commit(state, directory, [{ op: proposal.op, collection: proposal.collection, id: proposal.id, entry }], 'apply', snapshotId);
    return { proposal, snapshotId, applied: true };
  });
}
