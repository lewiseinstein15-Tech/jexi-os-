/**
 * JEXI OS — Phase 10 Scope I — HISTORY (read-only).
 *
 * Reads history from workgraph/session NDJSON journal.
 * READ-ONLY — never writes.
 * Single-pass NDJSON reader is fine (per spec).
 *
 * Journal format (from workgraph/session/store.js):
 *  seq-contiguous NDJSON, first record op:'session' {family, nodes:[]}
 *  then op:'append' {node}, op:'update' {id, payload}, op:'checkpoint', op:'compact'
 *
 * We reconstruct logical nodes (original, not physical compact view),
 * same as store.load() does.
 */

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SESSION_DIR = path.resolve('.jexi/sessions');
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

export function sessionPath(directory, id) {
  if (typeof id !== 'string' || !SESSION_ID_RE.test(id)) {
    throw fail('E_SESSION_ID', `Invalid session id: ${String(id).slice(0, 100)}`);
  }
  return path.join(directory, `${id}.ndjson`);
}

export function records(directory, id) {
  const file = sessionPath(directory, id);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  if (text && !text.endsWith('\n')) throw fail('E_JOURNAL_INCOMPLETE');
  const lines = text.split('\n').filter(Boolean);
  return lines.map((line, i) => {
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      throw fail('E_JOURNAL_CORRUPT');
    }
    if (r.seq !== i + 1) throw fail('E_JOURNAL_CORRUPT');
    return r;
  });
}

export function load(directory, id) {
  const rows = records(directory, id);
  if (!rows.length) throw fail('E_SESSION_NOT_FOUND', `Session not found: ${id}`);
  const first = rows[0];
  if (first.op !== 'session') throw fail('E_JOURNAL_CORRUPT');
  const state = {
    family: first.family,
    nodes: copy(first.nodes || []),
    physical: null,
    checkpointId: null,
  };
  const checkpoints = new Map();
  for (const r of rows.slice(1)) {
    if (r.op === 'append') {
      state.nodes.push(copy(r.node));
      state.physical = null;
    } else if (r.op === 'update') {
      const node = state.nodes.find(n => n.id === r.id);
      if (!node) throw fail('E_JOURNAL_CORRUPT');
      node.payload = copy(r.payload);
      state.physical = null;
    } else if (r.op === 'checkpoint') {
      checkpoints.set(r.checkpointId, copy(r.nodes));
    } else if (r.op === 'compact') {
      const nodes = checkpoints.get(r.checkpointId);
      if (!nodes) throw fail('E_CHECKPOINT_NOT_FOUND');
      state.nodes = copy(nodes);
      state.physical = copy(r.nodes);
      state.checkpointId = r.checkpointId;
    } else {
      throw fail('E_JOURNAL_CORRUPT');
    }
  }
  return state;
}

export function loadNodes(directory, sessionId) {
  const state = load(directory, sessionId);
  return state.nodes;
}

/**
 * history.query({sessionId, filter?, limit?, directory?})
 * filter can be:
 *  - function(node) => boolean
 *  - object { kind: 'task', ... } matching top-level or payload fields
 */
export function query(opts = {}) {
  const sessionId = opts.sessionId || opts.id;
  if (!sessionId) throw fail('E_SESSION_ID', 'sessionId required');
  const dir = opts.directory ? path.resolve(opts.directory) : DEFAULT_SESSION_DIR;
  let nodes;
  try {
    nodes = loadNodes(dir, sessionId);
  } catch (e) {
    if (e.code === 'E_SESSION_NOT_FOUND') return [];
    throw e;
  }

  let filtered = nodes;

  if (opts.filter) {
    if (typeof opts.filter === 'function') {
      filtered = filtered.filter(opts.filter);
    } else if (typeof opts.filter === 'object') {
      const f = opts.filter;
      filtered = filtered.filter(node => {
        for (const [k, v] of Object.entries(f)) {
          // Match top-level first, then payload
          if (k in node) {
            if (node[k] !== v) return false;
          } else if (node.payload && typeof node.payload === 'object' && k in node.payload) {
            if (node.payload[k] !== v) return false;
          } else {
            return false;
          }
        }
        return true;
      });
    }
  }

  if (Number.isInteger(opts.limit) && opts.limit >= 0) {
    filtered = filtered.slice(0, opts.limit);
  }

  return filtered.map(copy);
}

/**
 * history.recent(sessionId, n)
 * Returns last n nodes
 */
export function recent(sessionId, n = 10, opts = {}) {
  // Support object form recent({sessionId, n}) or recent(sessionId, n, {directory})
  let sid = sessionId;
  let count = n;
  let directory = opts.directory;

  if (typeof sessionId === 'object' && sessionId !== null) {
    sid = sessionId.sessionId || sessionId.id;
    count = sessionId.n ?? sessionId.count ?? sessionId.limit ?? n;
    directory = sessionId.directory || directory;
  }
  if (typeof sid !== 'string') throw fail('E_SESSION_ID', 'sessionId required');
  if (typeof count === 'object' && count !== null) {
    directory = count.directory || directory;
    count = count.n ?? count.count ?? 10;
  }
  count = Number(count);
  if (!Number.isFinite(count) || count < 0) count = 10;
  count = Math.trunc(count);

  const dir = directory ? path.resolve(directory) : DEFAULT_SESSION_DIR;
  let nodes;
  try {
    nodes = loadNodes(dir, sid);
  } catch (e) {
    if (e.code === 'E_SESSION_NOT_FOUND') return [];
    throw e;
  }
  const sliced = count === 0 ? [] : nodes.slice(-count);
  return sliced.map(copy);
}

/**
 * history.search(sessionId, predicate)
 * predicate is function(node) => boolean
 */
export function search(sessionId, predicate, opts = {}) {
  let sid = sessionId;
  let pred = predicate;
  let directory = opts.directory;

  if (typeof sessionId === 'object' && sessionId !== null) {
    sid = sessionId.sessionId || sessionId.id;
    pred = sessionId.predicate || sessionId.filter || predicate;
    directory = sessionId.directory || directory;
  }
  if (typeof sid !== 'string') throw fail('E_SESSION_ID', 'sessionId required');
  if (typeof pred !== 'function') throw fail('E_PREDICATE', 'predicate must be a function');

  const dir = directory ? path.resolve(directory) : DEFAULT_SESSION_DIR;
  let nodes;
  try {
    nodes = loadNodes(dir, sid);
  } catch (e) {
    if (e.code === 'E_SESSION_NOT_FOUND') return [];
    throw e;
  }
  return nodes.filter(pred).map(copy);
}

export const history = {
  query,
  recent,
  search,
  load: loadNodes,
  DEFAULT_DIR: DEFAULT_SESSION_DIR,
};

export default history;
