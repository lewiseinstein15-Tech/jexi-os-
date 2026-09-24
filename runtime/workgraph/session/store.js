import fs from 'node:fs';
import path from 'node:path';
export const fail = code => Object.assign(new Error(code), { code });
export function copy(value) {
  const seen = new Set();
  function check(v) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return;
    if (!v || typeof v !== 'object' || seen.has(v)) throw fail('E_JSON_VALUE');
    if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw fail('E_JSON_VALUE');
    seen.add(v);
    for (const key of Reflect.ownKeys(v)) {
      if (Array.isArray(v) && key === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (typeof key !== 'string' || !d.enumerable || !('value' in d)) throw fail('E_JSON_VALUE');
      check(d.value);
    }
    seen.delete(v);
  }
  check(value); return JSON.parse(JSON.stringify(value));
}
export function sessionPath(directory, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw fail('E_SESSION_ID');
  return path.join(directory, `${id}.ndjson`);
}
export function records(directory, id) {
  const file = sessionPath(directory, id);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  if (text && !text.endsWith('\n')) throw fail('E_JOURNAL_INCOMPLETE');
  return text.split('\n').filter(Boolean).map((line, i) => {
    const r = JSON.parse(line); if (r.seq !== i + 1) throw fail('E_JOURNAL_CORRUPT'); return r;
  });
}
export function load(directory, id) {
  const rows = records(directory, id);
  if (!rows.length) throw fail('E_SESSION_NOT_FOUND');
  const first = rows[0];
  if (first.op !== 'session') throw fail('E_JOURNAL_CORRUPT');
  const state = { family: first.family, nodes: copy(first.nodes), physical: null };
  const checkpoints = new Map();
  for (const r of rows.slice(1)) {
    if (r.op === 'append') { state.nodes.push(r.node); state.physical = null; }
    else if (r.op === 'update') { const node = state.nodes.find(n => n.id === r.id); if (!node) throw fail('E_JOURNAL_CORRUPT'); node.payload = r.payload; state.physical = null; }
    else if (r.op === 'checkpoint') checkpoints.set(r.checkpointId, r.nodes);
    else if (r.op === 'compact') {
      const nodes = checkpoints.get(r.checkpointId); if (!nodes) throw fail('E_CHECKPOINT_NOT_FOUND');
      state.nodes = copy(nodes); state.physical = r.nodes; state.checkpointId = r.checkpointId;
    } else throw fail('E_JOURNAL_CORRUPT');
  }
  return state;
}
export function locked(directory, fn) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, '.writer.lock'); let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); } catch (e) { if (e.code === 'EEXIST') throw fail('E_STORE_BUSY'); throw e; }
  try { return fn(); } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
export function write(directory, id, events) {
  const file = sessionPath(directory, id); const seq = records(directory, id).length;
  const fd = fs.openSync(file, 'a', 0o600);
  try { fs.writeFileSync(fd, events.map((r, i) => JSON.stringify({ ...r, seq: seq + i + 1 })).join('\n') + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function createStore({ directory = path.resolve('.jexi/sessions'), sessionId, clock = () => new Date().toISOString() } = {}) {
  directory = path.resolve(directory); sessionPath(directory, sessionId);
  return {
    directory, sessionId, path: sessionPath(directory, sessionId),
    append(input) {
      return locked(directory, () => {
        const existing = records(directory, sessionId);
        const nodes = existing.length ? load(directory, sessionId).nodes : [];
        const parentId = input.parentId ?? null;
        if (parentId !== null && !nodes.some(n => n.id === parentId)) throw fail('E_PARENT_NOT_FOUND');
        if (nodes.length && parentId !== nodes.at(-1).id) throw fail('E_BRANCH_HEAD_REQUIRED');
        if (!nodes.length && parentId !== null) throw fail('E_PARENT_NOT_FOUND');
        if (typeof input.kind !== 'string' || !input.kind || input.payload === undefined) throw fail('E_NODE_SCHEMA');
        const id = input.id ?? `${sessionId}:${nodes.length}`;
        if (typeof id !== 'string' || !id || nodes.some(n => n.id === id)) throw fail('E_NODE_ID');
        // IDs are unique in the union, except explicitly shared fork ancestors.
        for (const name of fs.readdirSync(directory).filter(n => n.endsWith('.ndjson'))) {
          const other = load(directory, name.slice(0, -7));
          const family = existing.length ? load(directory, sessionId).family : sessionId;
          if (other.family === family && other.nodes.some(n => n.id === id)) throw fail('E_NODE_ID');
        }
        const ts = input.ts ?? clock(); if (typeof ts !== 'string' || !Number.isFinite(Date.parse(ts))) throw fail('E_NODE_TIMESTAMP');
        const node = { id, parentId, kind: input.kind, payload: copy(input.payload), ts, seq: existing.length ? existing.length + 1 : 2 };
        const events = existing.length ? [] : [{ op: 'session', family: sessionId, nodes: [] }];
        events.push({ op: 'append', node }); write(directory, sessionId, events); return copy(node);
      });
    },
    update(id, payload) {
      return locked(directory, () => {
        const node = load(directory, sessionId).nodes.find(n => n.id === id); if (!node) throw fail('E_NODE_NOT_FOUND');
        const value = copy(payload); write(directory, sessionId, [{ op: 'update', id, payload: value }]); return { ...copy(node), payload: value };
      });
    },
  };
}
