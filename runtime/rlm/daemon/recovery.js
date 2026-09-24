import fs from 'node:fs';
export function error(code) { return Object.assign(new Error(code), { code }); }
export function readJournal(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  if (text && !text.endsWith('\n')) throw error('E_JOURNAL_INCOMPLETE');
  return text.split('\n').filter(Boolean).map((line, i) => {
    const r = JSON.parse(line);
    if (r.seq !== i + 1 || !r.sessionId || !r.kind || !r.ts) throw error('E_JOURNAL_CORRUPT');
    return r;
  });
}
export function append(file, sessionId, kind, payload = {}) {
  const record = { seq: readJournal(file).length + 1, ts: new Date().toISOString(), sessionId, kind, payload };
  const fd = fs.openSync(file, 'a', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(record) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return record;
}
export function registry(file) {
  const sessions = new Map();
  for (const r of readJournal(file)) {
    if (r.kind === 'session.opened') sessions.set(r.sessionId, { id: r.sessionId, startedAt: r.ts, lastActivity: r.ts, status: 'inactive', snapshot: null });
    const s = sessions.get(r.sessionId);
    if (!s) throw error('E_JOURNAL_CORRUPT');
    s.lastActivity = r.ts;
    if (r.kind === 'checkpoint') s.snapshot = r.payload.snapshot;
    if (r.kind === 'session.closed') s.closed = true;
  }
  return sessions;
}
