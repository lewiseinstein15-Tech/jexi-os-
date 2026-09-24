// computer/events/map.js
// Phase 29 Scope K — GUI-agent event -> Phase 16 taxonomy event (PURE map).
//
// TARS AgentEventStream discipline (declared): an agent run is described by a
// stream of typed events; JEXI Phase 16 already owns a closed chat-event
// taxonomy (events/chat/taxonomy.js), a router, and row renderers. This
// module MAPS GUI-agent events INTO that existing taxonomy — it does NOT
// create a parallel event system. Every mapped event is a Phase 16 event:
//   { type, version, ts, sessionId, agentId?, payload }
// and every mapped event validates against taxonomy.validate() (the router
// gates on exactly that).
//
// Declared mapping (Scope K contract; MAP_TABLE below is the authority):
//   screenshot_taken     -> tool.started   (toolName 'gui.screenshot')
//   vlm_prediction       -> narration.line (ctx.guiType 'thinking')
//   action_parsed        -> tool.started   (toolName 'gui.<action>')
//   action_result_ok     -> tool.completed
//   action_result_fail   -> tool.failed
//   loop_finished        -> turn.completed
//
// The six GUI event kinds form a CLOSED SET (GUI_EVENT_KINDS). Anything else
// is an unknown GUI event -> E_UNKNOWN_GUI_EVENT. Nothing is silently
// dropped: the refusal THROWS from map()/emit() before the router ever sees
// the event.
//
// Purity / determinism discipline:
// - map() is a pure function of (guiEvent): no clock, no randomness, no I/O.
//   The Phase 16 event's `ts` comes FROM the guiEvent (ISO string or epoch
//   number — exactly what taxonomy.validate accepts); map() NEVER calls
//   Date.now(). Timestamping is the emitter's (host's) job.
// - toolCallId is DERIVED (`gui-s<step>-screenshot` / `gui-s<step>-<action>`),
//   never generated randomly.
// - The same guiEvent maps to a byte-identical Phase 16 event, forever.
//
// Validation layering (misuse -> fail fast, environment -> unavailable):
// - kind not in the closed set (or guiEvent not an object) -> E_UNKNOWN_GUI_EVENT
//   (the declared Scope K code; everything else reuses declared codes).
// - malformed field on a KNOWN kind -> E_INVALID_ARGUMENT (reused).
// - action names are validated against Scope A's declared closed set
//   (actionNames() — read-only consumption); a GUI agent can only parse the
//   nine declared v1 actions, so anything else is malformed input.
//
// 'thinking' reconciliation (declared, disclosed): the Phase 16
// narrationType enum is closed — acknowledge|recon|finding|decision|
// progress|correction|completion — and has no 'thinking' member. The GUI
// thinking classification therefore rides in payload.ctx.guiType ('thinking')
// while payload.narrationType carries the declared enum member 'recon' (the
// VLM prediction line is the model's read of the screen). This keeps every
// emitted event taxonomy-valid — the alternative (narrationType:'thinking')
// would fail taxonomy.validate() and be refused by the router.

import { ComputerError } from '../errors.js';
import { actionNames } from '../action/space.js';
import { taxonomy } from '../../../runtime/events/chat/taxonomy.js';

// Declared Scope K error codes (ComputerError; E_INVALID_ARGUMENT reused for
// malformed known-kind input — no new error classes, per house rules).
export const EVENT_CODES = Object.freeze(['E_UNKNOWN_GUI_EVENT']);

export const CHAT_EVENT_VERSION = 1;

/** The closed set of GUI-agent event kinds this scope maps. */
export const GUI_EVENT_KINDS = Object.freeze([
  'screenshot_taken',
  'vlm_prediction',
  'action_parsed',
  'action_result_ok',
  'action_result_fail',
  'loop_finished',
]);

/** Declared mapping: GUI kind -> Phase 16 event type. */
export const MAP_TABLE = Object.freeze({
  screenshot_taken: 'tool.started',
  vlm_prediction: 'narration.line',
  action_parsed: 'tool.started',
  action_result_ok: 'tool.completed',
  action_result_fail: 'tool.failed',
  loop_finished: 'turn.completed',
});

export const GUI_TOOL_PREFIX = 'gui.';
export const GUI_SCREENSHOT_TOOL = 'gui.screenshot';

/** GUI-side classification carried in narration.line payload.ctx.guiType. */
export const THINKING_GUI_TYPE = 'thinking';
/** Declared Phase 16 enum member used for the GUI thinking stream. */
export const THINKING_NARRATION_TYPE = 'recon';

/** Scope F loop stop taxonomy (declared there; redeclared here as the gate). */
export const STOPPED_BY = Object.freeze(['finished', 'max-loops', 'error']);
/** loop_finished stoppedBy -> turn.completed payload.status (Phase 16 enum ok|fail). */
export const STOPPED_BY_STATUS = Object.freeze({ finished: 'ok', 'max-loops': 'ok', error: 'fail' });

const ACTION_NAMES = actionNames(); // Scope A closed set (read-only)

function invalidArgument(message, details) {
  return new ComputerError('E_INVALID_ARGUMENT', message, details ?? {});
}

function unknownGuiEvent(message, details) {
  return new ComputerError('E_UNKNOWN_GUI_EVENT', message, details ?? {});
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Exactly the ts shapes taxonomy.validate accepts: ISO string or finite number. */
function isValidTs(ts) {
  if (typeof ts === 'number') return Number.isFinite(ts);
  if (typeof ts === 'string') return ts.length > 0 && Number.isFinite(Date.parse(ts));
  return false;
}

/** Validate and copy an optional JSON-safe value (deep-normalized). */
function jsonSafe(value, label) {
  if (value === undefined) return undefined;
  let out;
  try {
    out = JSON.parse(JSON.stringify(value));
  } catch {
    throw invalidArgument(`map: ${label} must be JSON-safe`, { label });
  }
  if (out === undefined) {
    throw invalidArgument(`map: ${label} must be JSON-safe`, { label });
  }
  return out;
}

/**
 * The declared validation order:
 *   1. object + kind (closed set)      -> E_UNKNOWN_GUI_EVENT
 *   2. ts (ISO string or epoch number) -> E_INVALID_ARGUMENT
 *   3. sessionId (Phase 16 SESSION_ID_RE, read from the taxonomy itself)
 *   4. agentId (optional, AGENT_ID_RE) -> E_INVALID_ARGUMENT
 *   5. turnId (optional; REQUIRED for loop_finished — turn.completed needs it)
 *   6. kind-specific fields (step / action / text / shot / result / error /
 *      stoppedBy)                      -> E_INVALID_ARGUMENT
 * Nothing mutates the input; the mapped event is frozen.
 */
export function map(guiEvent) {
  if (!isObject(guiEvent)) {
    throw unknownGuiEvent('map: guiEvent must be an object carrying a declared kind', {
      got: guiEvent === null ? 'null' : typeof guiEvent,
    });
  }
  const { kind } = guiEvent;
  if (typeof kind !== 'string' || !GUI_EVENT_KINDS.includes(kind)) {
    throw unknownGuiEvent(`map: unknown GUI event kind (declared kinds: ${GUI_EVENT_KINDS.join(', ')})`, {
      got: typeof kind === 'string' ? kind : typeof kind,
    });
  }

  const { ts, sessionId, agentId, turnId } = guiEvent;
  if (!isValidTs(ts)) {
    throw invalidArgument('map: ts must be an ISO date string or a finite epoch number (map never reads the clock — determinism discipline)', {
      got: ts === null ? 'null' : typeof ts,
    });
  }
  if (typeof sessionId !== 'string' || !taxonomy.SESSION_ID_RE.test(sessionId)) {
    throw invalidArgument('map: sessionId must match the Phase 16 SESSION_ID_RE ([A-Za-z0-9_-]{1,100})', {
      got: sessionId === null ? 'null' : typeof sessionId,
    });
  }
  if (agentId !== undefined && (typeof agentId !== 'string' || !taxonomy.AGENT_ID_RE.test(agentId))) {
    throw invalidArgument('map: agentId must match the Phase 16 AGENT_ID_RE ([A-Za-z0-9_-]{1,100})', {
      got: agentId === null ? 'null' : typeof agentId,
    });
  }
  if (turnId !== undefined && (typeof turnId !== 'string' || turnId.length === 0)) {
    throw invalidArgument('map: turnId must be a non-empty string when provided', { got: typeof turnId });
  }
  if (kind === 'loop_finished' && (typeof turnId !== 'string' || turnId.length === 0)) {
    throw invalidArgument('map: loop_finished requires turnId (turn.completed payload requires it)', {
      got: turnId === undefined ? 'undefined' : typeof turnId,
    });
  }

  const event = {
    type: MAP_TABLE[kind],
    version: CHAT_EVENT_VERSION,
    ts,
    sessionId,
  };
  if (agentId !== undefined) event.agentId = agentId;

  const payload = {};

  if (kind === 'screenshot_taken') {
    const { step, shot } = guiEvent;
    if (!Number.isInteger(step) || step < 1) {
      throw invalidArgument('map: screenshot_taken requires step (integer >= 1)', { got: typeof step });
    }
    if (shot !== undefined) {
      if (!isObject(shot)) {
        throw invalidArgument('map: shot must be an object when provided', { got: typeof shot });
      }
      const { width, height, dpi } = shot;
      if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 || !Number.isFinite(dpi)) {
        throw invalidArgument('map: shot must carry integer width/height >= 1 and a finite dpi', {
          width: width === undefined ? 'undefined' : width,
          height: height === undefined ? 'undefined' : height,
          dpi: dpi === undefined ? 'undefined' : typeof dpi,
        });
      }
    }
    payload.toolCallId = `gui-s${step}-screenshot`;
    payload.toolName = GUI_SCREENSHOT_TOOL;
    if (turnId !== undefined) payload.turnId = turnId;
    if (shot !== undefined) {
      payload.args = { width: shot.width, height: shot.height, dpi: shot.dpi };
    }
  } else if (kind === 'vlm_prediction') {
    const { step, text } = guiEvent;
    if (!Number.isInteger(step) || step < 1) {
      throw invalidArgument('map: vlm_prediction requires step (integer >= 1)', { got: typeof step });
    }
    if (typeof text !== 'string' || text.length === 0) {
      throw invalidArgument('map: vlm_prediction requires text (the prediction line, non-empty string)', {
        got: text === undefined ? 'undefined' : typeof text,
      });
    }
    payload.narrationType = THINKING_NARRATION_TYPE;
    payload.text = text;
    payload.ctx = { guiType: THINKING_GUI_TYPE, step };
    if (turnId !== undefined) payload.turnId = turnId;
  } else if (kind === 'action_parsed') {
    const { step, action } = guiEvent;
    if (!Number.isInteger(step) || step < 1) {
      throw invalidArgument('map: action_parsed requires step (integer >= 1)', { got: typeof step });
    }
    if (typeof action !== 'string' || !ACTION_NAMES.includes(action)) {
      throw invalidArgument(`map: action_parsed requires a declared Scope A action (${ACTION_NAMES.join(', ')})`, {
        got: action === undefined ? 'undefined' : action,
      });
    }
    payload.toolCallId = `gui-s${step}-${action}`;
    payload.toolName = `${GUI_TOOL_PREFIX}${action}`;
    payload.args = { step };
    if (turnId !== undefined) payload.turnId = turnId;
  } else if (kind === 'action_result_ok') {
    const { step, action, result, durationMs } = guiEvent;
    if (!Number.isInteger(step) || step < 1) {
      throw invalidArgument('map: action_result_ok requires step (integer >= 1)', { got: typeof step });
    }
    if (typeof action !== 'string' || !ACTION_NAMES.includes(action)) {
      throw invalidArgument(`map: action_result_ok requires a declared Scope A action (${ACTION_NAMES.join(', ')})`, {
        got: action === undefined ? 'undefined' : action,
      });
    }
    if (durationMs !== undefined && (!Number.isFinite(durationMs) || durationMs < 0)) {
      throw invalidArgument('map: durationMs must be a finite number >= 0 when provided', { got: typeof durationMs });
    }
    payload.toolCallId = `gui-s${step}-${action}`;
    if (turnId !== undefined) payload.turnId = turnId;
    const safeResult = jsonSafe(result, 'result');
    if (safeResult !== undefined) payload.result = safeResult;
    if (durationMs !== undefined) payload.durationMs = durationMs;
  } else if (kind === 'action_result_fail') {
    const { step, action, error } = guiEvent;
    if (!Number.isInteger(step) || step < 1) {
      throw invalidArgument('map: action_result_fail requires step (integer >= 1)', { got: typeof step });
    }
    if (typeof action !== 'string' || !ACTION_NAMES.includes(action)) {
      throw invalidArgument(`map: action_result_fail requires a declared Scope A action (${ACTION_NAMES.join(', ')})`, {
        got: action === undefined ? 'undefined' : action,
      });
    }
    if (!isObject(error) || typeof error.code !== 'string' || error.code.length === 0 || typeof error.message !== 'string' || error.message.length === 0) {
      throw invalidArgument('map: action_result_fail requires error { code, message } (non-empty strings)', {
        got: error === undefined ? 'undefined' : typeof error,
      });
    }
    payload.toolCallId = `gui-s${step}-${action}`;
    payload.error = { code: error.code, message: error.message };
    if (turnId !== undefined) payload.turnId = turnId;
  } else {
    // kind === 'loop_finished' (the closed set makes this the only remainder)
    const { stoppedBy, summary } = guiEvent;
    if (typeof stoppedBy !== 'string' || !STOPPED_BY.includes(stoppedBy)) {
      throw invalidArgument(`map: loop_finished requires stoppedBy in the declared stop taxonomy (${STOPPED_BY.join(' | ')})`, {
        got: stoppedBy === undefined ? 'undefined' : stoppedBy,
      });
    }
    if (summary !== undefined && (typeof summary !== 'string' || summary.length === 0)) {
      throw invalidArgument('map: summary must be a non-empty string when provided', { got: typeof summary });
    }
    payload.turnId = turnId;
    payload.status = STOPPED_BY_STATUS[stoppedBy];
    payload.summary = summary ?? `gui loop stoppedBy=${stoppedBy}`;
  }

  event.payload = payload;
  return Object.freeze(event);
}

export default map;
