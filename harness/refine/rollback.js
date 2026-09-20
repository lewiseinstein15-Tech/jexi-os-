import path from 'node:path';
import { canonical, failure } from '../state/journal.js';
import { collections, current, locked, loadSnapshot, commit } from './storage.js';

export function rollback(snapshotId, { state, directory }) {
  return locked(state, () => {
    const snapshot = loadSnapshot(directory, snapshotId);
    if (snapshot.store !== path.resolve(state.journal.path)) throw failure('E_SNAPSHOT_STORE');
    const now = current(state);
    const records = [];
    for (const collection of collections) {
      if (canonical(now[collection]) === canonical(snapshot.state[collection])) continue;
      // Delete/create compensations restore exact entries, including removed fields.
      for (const entry of now[collection]) records.push({ op: 'delete', collection, id: entry.id });
      for (const entry of snapshot.state[collection]) records.push({ op: 'create', collection, id: entry.id, entry });
    }
    commit(state, directory, records, 'rollback', snapshotId);
    if (canonical(current(state)) !== canonical(snapshot.state)) throw failure('E_ROLLBACK_VERIFY');
    return { restored: true };
  });
}
