/**
 * JEXI OS — Phase 16 Scope O — Multi-Agent Chat View
 *
 * Purely presentational projections of the routed event log (Scope I). The four
 * modes answer "which agent spoke / how do streams relate / can I focus one":
 *   - single     : one merged transcript, no rails, no indents (default when
 *                  agents.length <= 1).
 *   - split      : one pane per agent, in first-appearance order.
 *   - interleaved: one transcript; per-event { agentId, rail, indent: 0 }.
 *   - nested     : subagent events indented under the parent's open tool call.
 *
 * View operations NEVER mutate the event log or turn history — they only read
 * router.history(sessionId).
 *
 * Agent discovery: any routed event carrying `agentId` opens a lane; events with
 * no agentId go to the pseudo-agent 'primary'.
 *
 * Colors: FNV-1a hash of agentId -> palette index. Same agentId -> same color
 * across runs (deterministic).
 *
 * Nesting rule (works with Phase 10 F's nuclear-family A2A, no explicit parent
 * field): an event from agent X at ts t is nested (depth>=1) under the most
 * recent open tool interval [tool.started .. tool.completed] belonging to a
 * DIFFERENT agent P with start<=t<=end. Depth = number of such containing
 * intervals from other agents (timestamp containment).
 */

import { router } from './router.js';
import { runtime } from './runtime.js';

export const MODES = ['single', 'split', 'interleaved', 'nested'];

const PALETTE = ['#ff7a3d', '#4cc38a', '#e5b567', '#ff6b5e', '#ffb88c', '#7aa2f7', '#c792ea', '#8be9fd'];

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

/** sessionId -> { mode, focused } */
const state = new Map();
function st(sessionId) {
  if (!state.has(sessionId)) state.set(sessionId, { mode: 'single', focused: null });
  return state.get(sessionId);
}

function assertSession(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) throw fail('E_UNKNOWN_SESSION', 'sessionId required');
  if (!runtime.isAttached(sessionId)) throw fail('E_UNKNOWN_SESSION', `unknown session: ${sessionId}`);
}

function hashId(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
export function colorFor(agentId) {
  return PALETTE[hashId(agentId) % PALETTE.length];
}

/** Read the routed log as a flat list of event descriptors, in seq order. */
function readLog(sessionId) {
  return router.history(sessionId).map((r) => {
    const e = r.event || {};
    return {
      seq: r.seq,
      type: r.type,
      agentId: typeof e.agentId === 'string' && e.agentId ? e.agentId : 'primary',
      ts: typeof e.ts === 'number' ? e.ts : r.seq,
      toolCallId: e.payload && typeof e.payload.toolCallId === 'string' ? e.payload.toolCallId : null,
      toolName: e.payload && typeof e.payload.toolName === 'string' ? e.payload.toolName : null,
      delta: e.payload && typeof e.payload.delta === 'string' ? e.payload.delta : null,
    };
  });
}

/** Discover agents in first-appearance order. */
function discover(log) {
  const order = [];
  const byId = new Map();
  for (const ev of log) {
    if (!byId.has(ev.agentId)) {
      byId.set(ev.agentId, { agentId: ev.agentId, name: ev.agentId, color: colorFor(ev.agentId), eventCount: 0, firstEventAt: ev.ts, lastEventAt: ev.ts });
      order.push(ev.agentId);
    }
    const a = byId.get(ev.agentId);
    a.eventCount += 1;
    a.lastEventAt = ev.ts;
  }
  return order.map((id) => ({ ...byId.get(id), status: 'active' }));
}

/** Build tool intervals [started..completed] per agent for nesting. */
function intervals(log) {
  const open = new Map();
  const out = [];
  for (const ev of log) {
    if (ev.type === 'tool.started' && ev.toolCallId) {
      open.set(ev.toolCallId, { agent: ev.agentId, start: ev.ts, end: null });
    } else if (ev.type === 'tool.completed' && ev.toolCallId && open.has(ev.toolCallId)) {
      const iv = open.get(ev.toolCallId);
      iv.end = ev.ts;
      out.push(iv);
      open.delete(ev.toolCallId);
    }
  }
  for (const iv of open.values()) { iv.end = iv.start; out.push(iv); }
  return out;
}

function depthFor(ev, ivs) {
  let d = 0;
  for (const iv of ivs) if (iv.agent !== ev.agentId && iv.start <= ev.ts && ev.ts <= iv.end) d += 1;
  return d;
}

function project(sessionId, mode, focused) {
  const log = readLog(sessionId);
  const agents = discover(log);
  const ivs = intervals(log);

  const isDesc = (ev) => ivs.some((iv) => iv.agent === focused && iv.start <= ev.ts && ev.ts <= iv.end);
  const visible = (ev) => !focused || ev.agentId === focused || (mode === 'nested' && isDesc(ev));

  let layout;
  if (mode === 'split') {
    layout = agents.map((a, i) => ({
      paneId: `pane-${i + 1}`,
      agentId: a.agentId,
      events: log.filter((ev) => ev.agentId === a.agentId && visible(ev)).map((ev) => ({ seq: ev.seq, type: ev.type, agentId: ev.agentId, rail: a.color, indent: 0, toolName: ev.toolName, delta: ev.delta })),
    }));
  } else {
    const events = log.filter(visible).map((ev) => {
      const base = { seq: ev.seq, type: ev.type, agentId: ev.agentId, toolName: ev.toolName, delta: ev.delta };
      if (mode === 'interleaved') return { ...base, rail: colorFor(ev.agentId), indent: 0 };
      if (mode === 'nested') return { ...base, rail: colorFor(ev.agentId), indent: depthFor(ev, ivs) };
      return { ...base, rail: null, indent: 0 }; // single
    });
    layout = [{ paneId: 'main', agentId: null, events }];
  }

  return { mode, agents: agents.map((a) => ({ agentId: a.agentId, name: a.name, color: a.color, eventCount: a.eventCount, firstEventAt: a.firstEventAt, lastEventAt: a.lastEventAt, status: a.status })), layout };
}

/**
 * @param {string} sessionId
 * @param {'single'|'split'|'interleaved'|'nested'} [mode]
 */
export function view(sessionId, mode) {
  assertSession(sessionId);
  const m = mode ?? st(sessionId).mode;
  if (!MODES.includes(m)) throw fail('E_UNKNOWN_MODE', `unknown view mode: ${m}`);
  return project(sessionId, m, st(sessionId).focused);
}

export function setMode(sessionId, mode) {
  assertSession(sessionId);
  if (!MODES.includes(mode)) throw fail('E_UNKNOWN_MODE', `unknown view mode: ${mode}`);
  st(sessionId).mode = mode;
  return { mode };
}

export function focus(sessionId, agentId) {
  assertSession(sessionId);
  const known = discover(readLog(sessionId)).some((a) => a.agentId === agentId);
  if (!known) throw fail('E_UNKNOWN_AGENT', `unknown agent: ${agentId}`);
  st(sessionId).focused = agentId;
  return { focusedAgent: agentId };
}

export function clearFocus(sessionId) {
  assertSession(sessionId);
  st(sessionId).focused = null;
  return { focusedAgent: null };
}

export function _reset() {
  state.clear();
}

export const multiagent = { view, setMode, focus, clearFocus, colorFor, _reset, MODES };
export default multiagent;
