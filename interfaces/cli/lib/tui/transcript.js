/**
 * JEXI TUI — transcript state.
 *
 * A pure reducer over rows: streaming deltas are APPENDED to the row that is
 * still open, tool rows are UPDATED IN PLACE by id (so a running tool flips
 * to success without a second row), and everything else appends. No I/O.
 */

import { eventToRows } from './rows.js';

/** Row kinds whose consecutive deltas merge into one growing row. */
const STREAMING = new Set(['text', 'thinking']);

export function createTranscript() {
  return {
    rows: [],
    stats: { turns: 0, tools: 0, toolErrors: 0, tokens: 0, firstTokenMs: null, lastDurationMs: null, by: '' },
    sessionId: 'tui',
  };
}

/**
 * Apply one wire event. Returns { changed, terminal, secretAsk }.
 * Mutates the transcript in place (the app owns a single instance).
 */
export function applyEvent(t, evt) {
  if (!evt || typeof evt !== 'object') return { changed: false, terminal: false, secretAsk: null };
  const type = String(evt.type || '');

  if (type === 'heartbeat') return { changed: false, terminal: false, secretAsk: null };

  if (type === 'ask.secret') {
    return { changed: false, terminal: false, secretAsk: { conv: evt.conv || 'default', id: evt.id, tool: evt.tool, reason: evt.reason } };
  }

  const incoming = eventToRows(evt);
  if (!incoming.length) return { changed: false, terminal: false, secretAsk: null };

  let changed = false;
  for (const r of incoming) {
    if (applyRow(t, r)) changed = true;
  }
  const terminal = type === 'done' || type === 'error' || type === 'turn.completed';
  if (terminal) t.stats.turns += 1;
  return { changed, terminal, secretAsk: null };
}

/** Merge a single row into the transcript. Returns true when state changed. */
export function applyRow(t, r) {
  const last = t.rows[t.rows.length - 1];

  // Streaming text: append to the open row of the same kind + same agent.
  if (STREAMING.has(r.kind) && last && last.kind === r.kind && (last.agent || '') === (r.agent || '')) {
    last.text = (last.text || '') + (r.text || '');
    if (r.text) t.stats.tokens += 1;
    return true;
  }

  // Tool rows: update in place by id so running → done is one row.
  if (r.id && (r.kind === 'tool-use' || r.kind === 'tool-result' || r.kind === 'tool-error')) {
    const existing = t.rows.find((x) => x.id === r.id && (x.kind.startsWith('tool-')));
    if (existing) {
      const wasRunning = existing.meta && existing.meta.status === 'running';
      existing.kind = r.kind;
      existing.text = r.text || existing.text;
      existing.meta = { ...(existing.meta || {}), ...(r.meta || {}) };
      if (wasRunning && r.meta && r.meta.status && r.meta.status !== 'running') {
        t.stats.tools += 1;
        if (r.meta.status === 'error') t.stats.toolErrors += 1;
      }
      return true;
    }
    t.rows.push(r);
    if (r.meta && r.meta.status && r.meta.status !== 'running') {
      t.stats.tools += 1;
      if (r.meta.status === 'error') t.stats.toolErrors += 1;
    }
    return true;
  }

  // Command rows: same id merges (stdout streams, then exit).
  if (r.kind === 'command' && r.id) {
    const existing = t.rows.find((x) => x.kind === 'command' && x.id === r.id);
    if (existing) {
      existing.meta = { ...(existing.meta || {}), ...(r.meta || {}) };
      if (r.text) existing.text = r.text;
      return true;
    }
    t.rows.push(r);
    return true;
  }

  if (r.kind === 'turn-end-ok' || r.kind === 'turn-end-fail') {
    const m = r.meta || {};
    if (m.firstTokenMs != null) t.stats.firstTokenMs = m.firstTokenMs;
    if (m.durationMs != null) t.stats.lastDurationMs = m.durationMs;
    if (m.by) t.stats.by = m.by;
  }

  t.rows.push(r);
  return true;
}

/** Append a local row (the user's own input, local notices). */
export function pushLocal(t, kind, text, meta = {}) {
  return applyRow(t, { kind, text, meta, ts: new Date().toISOString(), local: true });
}

/** Drop everything (used by /clear). */
export function resetTranscript(t, keepSession = true) {
  t.rows = [];
  t.stats = { turns: 0, tools: 0, toolErrors: 0, tokens: 0, firstTokenMs: null, lastDurationMs: null, by: '' };
  if (!keepSession) t.sessionId = 'tui';
  return t;
}

/** One-line status for the footer. */
export function statusLine(t, extra = {}) {
  const bits = [];
  if (extra.model) bits.push(extra.model);
  bits.push(`${t.stats.tools} tools`);
  if (t.stats.toolErrors) bits.push(`${t.stats.toolErrors} failed`);
  if (t.stats.firstTokenMs != null) bits.push(`first token ${t.stats.firstTokenMs}ms`);
  if (t.stats.lastDurationMs != null) bits.push(`last turn ${Math.round(t.stats.lastDurationMs)}ms`);
  return bits.join(' · ');
}

export default { createTranscript, applyEvent, applyRow, pushLocal, resetTranscript, statusLine };
