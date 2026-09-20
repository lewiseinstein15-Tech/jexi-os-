import fs from 'node:fs';
import path from 'node:path';

export function failure(code, message = code) { return Object.assign(new Error(message), { code }); }
export function jsonCopy(value) {
  const seen = new Set();
  function validate(v) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (!v || typeof v !== 'object' || seen.has(v)) throw failure('E_JSON_VALUE');
    if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw failure('E_JSON_VALUE');
    seen.add(v);
    for (const key of Reflect.ownKeys(v)) {
      if (Array.isArray(v) && key === 'length') continue;
      const desc = Object.getOwnPropertyDescriptor(v, key);
      if (typeof key !== 'string' || !desc.enumerable || !('value' in desc)) throw failure('E_JSON_VALUE');
      validate(desc.value);
    }
    seen.delete(v);
  }
  validate(value);
  return JSON.parse(JSON.stringify(value));
}
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

/** Authoritative append-only NDJSON. No truncate/update/delete API.
 * Exclusive fail-fast writer lock; reads replay fresh data, never stale caches.
 */
export class Journal {
  constructor({ directory = path.resolve('.state/harness'), clock = () => new Date().toISOString() } = {}) {
    this.path = path.join(path.resolve(directory), 'operations.ndjson');
    this.clock = clock;
    fs.mkdirSync(path.dirname(this.path), { recursive: true, mode: 0o700 });
  }
  read() {
    let text;
    try { text = fs.readFileSync(this.path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    if (text && !text.endsWith('\n')) throw failure('E_JOURNAL_CORRUPT', 'Incomplete journal tail; explicit recovery required');
    try {
      const records = text.split('\n').filter(Boolean).map(line => JSON.parse(line));
      records.forEach((r, i) => {
        if (r.version !== 1 || r.seq !== i + 1 || !['create', 'update', 'delete', 'immutable-violation'].includes(r.op) || typeof r.collection !== 'string' || typeof r.id !== 'string' || typeof r.timestamp !== 'string') throw failure('E_JOURNAL_CORRUPT');
      });
      return records;
    } catch (e) { throw failure('E_JOURNAL_CORRUPT', e.message); }
  }
  transaction(plan) {
    const lock = `${this.path}.lock`;
    let fd;
    try { fd = fs.openSync(lock, 'wx', 0o600); } catch (e) { if (e.code === 'EEXIST') throw failure('E_JOURNAL_BUSY'); throw e; }
    try {
      const records = this.read();
      const { record, result } = plan(records);
      const timestamp = this.clock();
      if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))) throw failure('E_JOURNAL_TIMESTAMP');
      const line = canonical({ ...jsonCopy(record), version: 1, seq: records.length + 1, timestamp }) + '\n';
      const out = fs.openSync(this.path, 'a', 0o600);
      try { fs.writeFileSync(out, line, 'utf8'); fs.fsyncSync(out); } finally { fs.closeSync(out); }
      return result;
    } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  }
  append(record) { return this.transaction(() => ({ record, result: undefined })); }
}
