/**
 * JEXI TUI — wire event → row mapping.
 *
 * The web console maps a Phase 16 taxonomy (message.delta, tool.started, …)
 * onto row types. The backend's /api/chat stream speaks a slightly older,
 * flatter vocabulary (stream, think, log, plan, tool_use, team, command,
 * done). This module is the bridge: it accepts BOTH, so the TUI renders the
 * exact same information the console does, from the real emitted fields —
 * no invented fields, no canned rows.
 *
 * Pure: every function takes an event and returns a row object or null.
 */

import { oneLine } from './ansi.js';

/** Wire event types that carry no transcript value (telemetry only). */
export const TELEMETRY = new Set(['heartbeat', 'intel', 'team', 'agent.log', 'subagent.aggregate', 'ask.secret']);

/**
 * @typedef {Object} Row
 * @property {string} kind      row type (text, thinking, tool-use, …)
 * @property {string} [id]      stable id for in-place updates (tool pairs)
 * @property {string} [text]    body text
 * @property {Object} [meta]    structured fields (tool name, status, …)
 * @property {string} ts        ISO timestamp
 */

function row(kind, fields = {}) {
  return { kind, ts: new Date().toISOString(), ...fields };
}

/** payload accessor — tolerates both flat and {payload:{}} events. */
function payloadOf(evt) {
  if (!evt || typeof evt !== 'object') return {};
  const p = evt.payload;
  if (p && typeof p === 'object') return p;
  return evt;
}

function toolNameOf(p, evt) {
  return String(p.toolName || p.name || p.tool || p.slug || (evt && evt.tool) || 'tool');
}

function argsOf(p) {
  if (p.args !== undefined) return typeof p.args === 'string' ? p.args : safeJson(p.args);
  if (p.arguments !== undefined) return typeof p.arguments === 'string' ? p.arguments : safeJson(p.arguments);
  return '';
}

function safeJson(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

/**
 * Map one wire event to zero or more rows.
 * Returns an array because a single event can produce a header + detail row.
 */
export function eventToRows(evt) {
  if (!evt || typeof evt !== 'object') return [];
  const type = String(evt.type || '');
  const p = payloadOf(evt);

  switch (type) {
    case 'user.message':
    case 'user':
      return [row('user', { text: String(p.text || evt.text || '') })];

    case 'stream':
    case 'message.delta':
      return [row('text', { text: String(p.text ?? p.delta ?? ''), agent: p.by || evt.by || '' })];

    case 'think':
    case 'thinking.delta':
      return [row('thinking', { text: String(p.text ?? p.delta ?? ''), agent: p.by || evt.by || '' })];

    case 'narration':
    case 'narration.line':
      return [row('narration', { text: String(p.text || '') })];

    case 'plan':
    case 'plan.created':
    case 'plan.updated': {
      const steps = Array.isArray(p.steps) ? p.steps : [];
      const titles = steps.map((s) => (s && (s.title || s.name || s.summary)) || '').filter(Boolean);
      const head = p.intent ? `plan · ${p.intent}` : (p.title || 'plan');
      return [row('plan', {
        text: head,
        meta: { steps: titles, roster: Array.isArray(p.roster) ? p.roster.length : 0 },
      })];
    }

    case 'tool_use': {
      const status = String(p.status || 'running');
      const kind = status === 'running' ? 'tool-use' : (status === 'success' ? 'tool-result' : 'tool-error');
      return [row(kind, {
        id: p.id || `tu-${p.slug || p.tool}`,
        text: toolNameOf(p, evt),
        meta: {
          args: p.slug || '',
          status,
          durationMs: Number(p.duration_ms) || 0,
          summary: oneLine(p.summary || '', 200),
          detail: oneLine(p.detail || '', 2000),
          error: status === 'error' ? oneLine(p.summary || p.detail || 'failed', 200) : '',
        },
      })];
    }

    case 'tool.started':
    case 'tool.progress':
    case 'tool/call':
      return [row('tool-use', {
        id: p.id || p.callId || `tu-${toolNameOf(p, evt)}`,
        text: toolNameOf(p, evt),
        meta: { args: oneLine(argsOf(p), 120), status: 'running', progress: p.progress },
      })];

    case 'tool.completed':
    case 'tool/result': {
      const ok = p.ok !== false && !p.error;
      const body = p.result !== undefined ? (typeof p.result === 'string' ? p.result : safeJson(p.result))
        : (p.content !== undefined ? String(p.content) : '');
      return [row(ok ? 'tool-result' : 'tool-error', {
        id: p.id || p.callId || `tu-${toolNameOf(p, evt)}`,
        text: toolNameOf(p, evt),
        meta: {
          status: ok ? 'success' : 'error',
          detail: oneLine(body, 4000),
          error: ok ? '' : oneLine(p.error || 'tool failed', 200),
        },
      })];
    }

    case 'tool.failed':
      return [row('tool-error', {
        id: p.id || p.callId || `tu-${toolNameOf(p, evt)}`,
        text: toolNameOf(p, evt),
        meta: { status: 'error', error: oneLine(p.error || p.message || 'tool failed', 200) },
      })];

    case 'approval.requested':
      return [row('approval', {
        text: oneLine(p.reason || p.summary || 'approval requested', 200),
        meta: { approvalId: p.approvalId || '', decision: 'requested', risk: p.risk || '' },
      })];

    case 'approval.resolved':
      return [row('approval', {
        text: oneLine(p.reason || p.decision || 'resolved', 200),
        meta: { approvalId: p.approvalId || '', decision: p.decision || 'resolved' },
      })];

    case 'agent.spawned':
    case 'agent.completed': {
      const who = p.agentName || p.agentId || p.agent || 'agent';
      const what = oneLine(p.summary || p.task || '', 200);
      return [row('agent', { text: who, meta: { event: type, summary: what } })];
    }

    case 'agent.done':
      return [row('agent', {
        text: String(p.agent || evt.agent || 'agent'),
        meta: { event: 'agent.done', summary: oneLine(p.summary || p.answer || '', 200) },
      })];

    case 'command':
      return [row('command', {
        id: p.id || '', text: oneLine(p.cmd || '', 200),
        meta: { status: p.status || 'running', chunk: p.chunk || '' },
      })];

    case 'command.done':
      return [row('command', {
        id: p.id || '', text: '',
        meta: {
          status: p.exit === 0 ? 'success' : 'error',
          exit: p.exit, durationMs: Number(p.duration_ms) || 0,
          stdout: oneLine(p.stdout || '', 4000), stderr: oneLine(p.stderr || '', 2000),
        },
      })];

    case 'log':
      return [row('log', { text: oneLine(p.message || '', 400), agent: p.agent || '' })];

    case 'turn.completed':
      return [row(p.success === false || p.status === 'fail' ? 'turn-end-fail' : 'turn-end-ok', {
        text: oneLine(p.summary || '', 400),
        meta: { statistics: p.statistics || null },
      })];

    case 'done':
      return [row(p.success === false ? 'turn-end-fail' : 'turn-end-ok', {
        text: oneLine(p.summary || '', 400),
        meta: {
          statistics: p.statistics || null,
          firstTokenMs: evt.firstTokenMs ?? p.firstTokenMs ?? null,
          durationMs: evt.durationMs ?? p.durationMs ?? null,
          by: evt.by || p.by || p.writer || '',
          sources: p.sources || null,
          error: p.error || null,
        },
      })];

    case 'error':
      return [row('turn-end-fail', {
        text: oneLine(p.error || p.message || 'unknown error', 400),
        meta: { error: p.error || p.message || 'unknown error' },
      })];

    case 'ask.user':
      return [row('approval', { text: oneLine(p.question || p.message || 'input needed', 200), meta: { decision: 'requested' } })];

    default:
      return [];
  }
}

/** Is this event terminal for the turn? */
export function isTerminal(evt) {
  const t = String((evt && evt.type) || '');
  return t === 'done' || t === 'error' || t === 'turn.completed';
}

/** Does this event ask for a one-time secret paste? */
export function secretAskOf(evt) {
  if (!evt || evt.type !== 'ask.secret') return null;
  return { conv: evt.conv || 'default', id: evt.id, tool: evt.tool, reason: evt.reason };
}

export default { eventToRows, isTerminal, secretAskOf, TELEMETRY };
