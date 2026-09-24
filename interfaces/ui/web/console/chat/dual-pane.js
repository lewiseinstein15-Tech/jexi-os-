/**
 * JEXI OS — Phase 16 Scope E — Dual-Pane Process/Results
 *
 * Process (thinking, tool calls, narration) goes on one side.
 * Results (final answer, artifacts) go on the other.
 * When turn succeeds, process collapses into one-line summary. Results persist.
 *
 * Contract:
 *  dualPane.split(events) -> { processEvents, resultEvents }
 *  dualPane.collapse(processEvents) -> { summary, collapsed: true, eventCount }
 *  dualPane.state(turnId) -> { process: 'expanded'|'collapsed', result: 'empty'|'populated', summary? }
 *
 * Classification:
 *  process: thinking.delta, tool.started/progress/completed/failed, narration.line,
 *           agent.spawned/completed, plan.created/updated, checkpoint.created,
 *           approval.requested/resolved
 *  result: message.delta, artifact.created, turn.completed
 */

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

// Known types from Scope A taxonomy (16 types)
const PROCESS_TYPES = new Set([
  'thinking.delta',
  'tool.started',
  'tool.progress',
  'tool.completed',
  'tool.failed',
  'narration.line',
  'agent.spawned',
  'agent.completed',
  'plan.created',
  'plan.updated',
  'checkpoint.created',
  'approval.requested',
  'approval.resolved',
]);

const RESULT_TYPES = new Set([
  'message.delta',
  'artifact.created',
  'turn.completed',
]);

const ALL_KNOWN = new Set([...PROCESS_TYPES, ...RESULT_TYPES]);

// Internal state per turnId
const turnStates = new Map(); // turnId -> { process, result, summary, eventCount, collapsed }

function isSuccessTurnCompleted(payload) {
  if (!payload) return false;
  if (payload.success === true) return true;
  if (payload.success === false) return false;
  if (payload.status === 'ok') return true;
  if (payload.status === 'fail') return false;
  // Default to false if unknown? But spec says success true collapses, false stays expanded.
  // If payload has no success/status, treat as success? Safer to treat as false unless explicit true/ok
  return false;
}

function computeDurationSeconds(processEvents) {
  if (!processEvents || processEvents.length < 2) return 0;
  try {
    const first = processEvents[0]?.ts;
    const last = processEvents[processEvents.length - 1]?.ts;
    if (!first || !last) return 0;
    const t1 = Date.parse(first);
    const t2 = Date.parse(last);
    if (!Number.isFinite(t1) || !Number.isFinite(t2)) return 0;
    const diffMs = Math.abs(t2 - t1);
    return Math.round(diffMs / 1000);
  } catch {
    return 0;
  }
}

export function split(events) {
  if (!Array.isArray(events)) {
    throw fail('E_UNKNOWN_EVENT', 'events must be an array');
  }

  if (events.length === 0) {
    return { processEvents: [], resultEvents: [] };
  }

  const processEvents = [];
  const resultEvents = [];

  let turnId = null;
  let hasSuccessTrue = false;
  let hasSuccessFalse = false;
  let hasTurnCompleted = false;

  for (const ev of events) {
    if (!ev || typeof ev.type !== 'string') {
      throw fail('E_UNKNOWN_EVENT', `Invalid event: ${JSON.stringify(ev).slice(0,100)}`);
    }

    if (!ALL_KNOWN.has(ev.type)) {
      throw fail('E_UNKNOWN_EVENT', `Unknown event type: ${ev.type}`);
    }

    // Extract turnId from turn.completed payload
    if (ev.type === 'turn.completed' && ev.payload && typeof ev.payload.turnId === 'string') {
      turnId = ev.payload.turnId;
      hasTurnCompleted = true;
      if (isSuccessTurnCompleted(ev.payload)) {
        hasSuccessTrue = true;
      } else {
        hasSuccessFalse = true;
      }
    }

    // Also try to extract turnId from any event that might have it? For safety, keep first found
    if (!turnId && ev.payload && typeof ev.payload.turnId === 'string') {
      turnId = ev.payload.turnId;
    }

    if (PROCESS_TYPES.has(ev.type)) {
      processEvents.push(ev);
    } else if (RESULT_TYPES.has(ev.type)) {
      resultEvents.push(ev);
    } else {
      // Should not happen because ALL_KNOWN check above, but safety
      throw fail('E_UNKNOWN_EVENT', `Unmapped event type: ${ev.type}`);
    }
  }

  // Auto-collapse logic based on turn.completed success
  if (turnId) {
    const resultPopulated = resultEvents.length > 0 ? 'populated' : 'empty';
    if (hasSuccessTrue && !hasSuccessFalse) {
      // success true -> collapse
      const summaryObj = collapse(processEvents);
      turnStates.set(turnId, {
        process: 'collapsed',
        result: resultPopulated,
        summary: summaryObj.summary,
        eventCount: summaryObj.eventCount,
        collapsed: true,
      });
    } else if (hasSuccessFalse || hasTurnCompleted) {
      // failure or turn completed with false -> expanded
      // If failure, keep expanded even if success also present? Spec: success=false -> expanded
      // For mixed case where both true and false present, treat as expanded to be safe (failure needs inspection)
      const isCollapsed = hasSuccessTrue && !hasSuccessFalse ? true : false;
      if (isCollapsed) {
        const summaryObj = collapse(processEvents);
        turnStates.set(turnId, {
          process: 'collapsed',
          result: resultPopulated,
          summary: summaryObj.summary,
          eventCount: summaryObj.eventCount,
          collapsed: true,
        });
      } else {
        turnStates.set(turnId, {
          process: 'expanded',
          result: resultPopulated,
          summary: undefined,
          eventCount: processEvents.length,
          collapsed: false,
        });
      }
    } else {
      // No turn.completed, just update result status but keep process expanded
      const existing = turnStates.get(turnId);
      if (!existing || existing.process !== 'collapsed') {
        turnStates.set(turnId, {
          process: 'expanded',
          result: resultPopulated,
          summary: existing?.summary,
          eventCount: processEvents.length,
          collapsed: false,
        });
      }
    }
  }

  return { processEvents, resultEvents };
}

export function collapse(processEvents) {
  if (!Array.isArray(processEvents)) {
    throw fail('E_UNKNOWN_EVENT', 'processEvents must be an array');
  }

  const eventCount = processEvents.length;
  const toolsCount = processEvents.filter(ev => ev.type && ev.type.startsWith('tool.')).length;
  const durationSec = computeDurationSeconds(processEvents);

  // Summary format: "<N> steps, <M> tools, <K>s"
  const summary = `${eventCount} steps, ${toolsCount} tools, ${durationSec}s`;

  return {
    summary,
    collapsed: true,
    eventCount,
  };
}

export function state(turnId) {
  if (!turnId || typeof turnId !== 'string') {
    return { process: 'expanded', result: 'empty' };
  }

  const st = turnStates.get(turnId);
  if (!st) {
    return { process: 'expanded', result: 'empty' };
  }

  // Return copy
  const result = {
    process: st.process,
    result: st.result,
  };
  if (st.summary) result.summary = st.summary;
  if (st.eventCount !== undefined) result.eventCount = st.eventCount;
  if (st.collapsed !== undefined) result.collapsed = st.collapsed;

  return result;
}

export function _reset() {
  turnStates.clear();
}

export const dualPane = {
  split,
  collapse,
  state,
  _reset,
  PROCESS_TYPES: [...PROCESS_TYPES],
  RESULT_TYPES: [...RESULT_TYPES],
};

export default dualPane;
