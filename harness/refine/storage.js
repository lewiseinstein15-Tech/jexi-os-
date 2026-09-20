import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonical, failure } from '../state/journal.js';
export const collections = ['prompt-notes', 'skills', 'memory', 'subagent-specs'];
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export function current(state) { return Object.fromEntries(collections.map(c => [c, state.list(c)])); }
export function locked(state, work) {
  const file = `${state.journal.path}.lock`;
  let fd;
  try { fd = fs.openSync(file, 'wx', 0o600); } catch (e) { if (e.code === 'EEXIST') throw failure('E_JOURNAL_BUSY'); throw e; }
  try { return work(); } finally { fs.closeSync(fd); fs.unlinkSync(file); }
}
function append(file, records) {
  const fd = fs.openSync(file, 'a', 0o600);
  try { fs.writeFileSync(fd, records.map(canonical).join('\n') + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function commit(state, directory, records, action, snapshotId) {
  const timestamp = new Date().toISOString();
  const seq = state.journal.read().length;
  if (records.length) append(state.journal.path, records.map((r, i) => ({ ...r, version: 1, seq: seq + i + 1, timestamp, refinement: { action, snapshotId } })));
  append(path.join(directory, 'refinements.ndjson'), [{ action, snapshotId, timestamp, mutations: records.length }]);
}
export function writeSnapshot(directory, payload) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const id = digest(payload);
  const file = path.join(directory, `${id}.json`);
  let fd;
  try { fd = fs.openSync(file, 'wx', 0o400); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  if (fd !== undefined) {
    try { fs.writeFileSync(fd, canonical(payload)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const dir = fs.openSync(directory, 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  }
  loadSnapshot(directory, id);
  return id;
}
export function loadSnapshot(directory, id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw failure('E_NO_SNAPSHOT');
  let payload;
  try { payload = JSON.parse(fs.readFileSync(path.join(directory, `${id}.json`), 'utf8')); } catch { throw failure('E_NO_SNAPSHOT'); }
  if (digest(payload) !== id || payload.version !== 1 || !payload.state || collections.some(c => !Array.isArray(payload.state[c]))) throw failure('E_NO_SNAPSHOT');
  return payload;
}
