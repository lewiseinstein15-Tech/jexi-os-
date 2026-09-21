/**
 * JEXI OS — Phase 16 Scope F — Progressive Disclosure
 *
 * Three layers of detail. Collapsed by default. User sees answer first, then "why", then full trace.
 *
 * Contract:
 *  disclosure.wrap(turn) -> { layers: [answer, why, trace], default: 'answer', expanded: false }
 *  disclosure.expand(turnId, layer) -> { turnId, layer, content, expanded: true }
 *  disclosure.collapse(turnId, layer) -> { turnId, layer, expanded: false }
 *  disclosure.state(turnId) -> { answer: 'visible', why: 'collapsed'|'expanded', trace: 'collapsed'|'expanded' }
 *
 * Layers:
 *  answer - final result. ALWAYS visible. Cannot be collapsed.
 *  why    - reasoning summary + evidence + sources. Collapsed by default, auto-expands while streaming.
 *  trace  - full tool sequence + raw output + timing. Collapsed by default, never auto-expands.
 */

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

const VALID_LAYERS = ['answer', 'why', 'trace'];
const VALID_LAYERS_SET = new Set(VALID_LAYERS);

// Internal state per turnId
const turnStates = new Map(); // turnId -> { answer: 'visible', why, trace, content: {answer, why, trace}, streaming }

function validateTurnId(turnId) {
  if (!turnId || typeof turnId !== 'string') {
    throw fail('E_UNKNOWN_TURN', 'turnId is required');
  }
}

function validateLayer(layer) {
  if (!VALID_LAYERS_SET.has(layer)) {
    throw fail('E_UNKNOWN_LAYER', `Unknown layer: ${layer}`);
  }
}

export function wrap(turn) {
  if (!turn || typeof turn !== 'object') {
    throw fail('E_UNKNOWN_TURN', 'turn object with turnId required');
  }

  const turnId = turn.turnId || turn.id;

  if (!turnId || typeof turnId !== 'string') {
    throw fail('E_UNKNOWN_TURN', 'turn.turnId is required');
  }

  // Rule 7: Unknown layer id in wrap -> E_UNKNOWN_LAYER
  if (turn.layers) {
    if (!Array.isArray(turn.layers)) {
      throw fail('E_UNKNOWN_LAYER', 'turn.layers must be array');
    }
    for (const l of turn.layers) {
      const layerId = typeof l === 'string' ? l : l.id || l.layer;
      if (layerId && !VALID_LAYERS_SET.has(layerId)) {
        throw fail('E_UNKNOWN_LAYER', `Unknown layer in wrap: ${layerId}`);
      }
    }
  }

  // Also check if turn has explicit layer fields that are unknown? Only allow answer, why, trace as content keys
  // If turn contains custom layer keys beyond allowed, treat as unknown layer if they are in a layers array, already handled

  const isStreaming = !!(turn.streaming || turn.isStreaming || turn.status === 'streaming' || turn.state === 'streaming' || turn.state === 'active');

  // Determine initial states per rules
  // answer always visible
  // why auto-expands while streaming, collapses at turn.completed
  // trace stays collapsed unless explicitly expanded
  const whyState = isStreaming ? 'expanded' : 'collapsed';
  const traceState = 'collapsed';

  const content = {
    answer: turn.answer || turn.finalMessage || turn.result || '',
    why: turn.why || turn.reasoning || turn.summary || '',
    trace: turn.trace || turn.toolLog || turn.steps || '',
  };

  turnStates.set(turnId, {
    answer: 'visible',
    why: whyState,
    trace: traceState,
    content,
    streaming: isStreaming,
    turnId,
  });

  return {
    layers: [...VALID_LAYERS],
    default: 'answer',
    expanded: false,
    turnId,
  };
}

export function expand(turnId, layer) {
  validateTurnId(turnId);
  validateLayer(layer);

  const st = turnStates.get(turnId);
  if (!st) {
    throw fail('E_UNKNOWN_TURN', `Unknown turnId: ${turnId}`);
  }

  // Idempotent: if already expanded/visible, return same
  if (layer === 'answer') {
    // answer always visible, expanding is no-op but allowed
    return {
      turnId,
      layer,
      content: st.content.answer,
      expanded: true,
    };
  }

  if (st[layer] === 'expanded') {
    // Idempotent no-op
    return {
      turnId,
      layer,
      content: st.content[layer],
      expanded: true,
    };
  }

  st[layer] = 'expanded';

  return {
    turnId,
    layer,
    content: st.content[layer],
    expanded: true,
  };
}

export function collapse(turnId, layer) {
  validateTurnId(turnId);
  validateLayer(layer);

  const st = turnStates.get(turnId);
  if (!st) {
    throw fail('E_UNKNOWN_TURN', `Unknown turnId: ${turnId}`);
  }

  // Rule 1: answer immutable, always visible, cannot be collapsed
  if (layer === 'answer') {
    throw fail('E_ANSWER_FIXED', 'answer layer cannot be collapsed');
  }

  // Idempotent: if already collapsed, no-op
  if (st[layer] === 'collapsed') {
    return {
      turnId,
      layer,
      expanded: false,
    };
  }

  st[layer] = 'collapsed';

  return {
    turnId,
    layer,
    expanded: false,
  };
}

export function state(turnId) {
  validateTurnId(turnId);

  const st = turnStates.get(turnId);
  if (!st) {
    throw fail('E_UNKNOWN_TURN', `Unknown turnId: ${turnId}`);
  }

  return {
    answer: st.answer, // always 'visible'
    why: st.why,
    trace: st.trace,
  };
}

// Helper for P7 to simulate turn.completed -> why collapses
export function _complete(turnId) {
  validateTurnId(turnId);
  const st = turnStates.get(turnId);
  if (!st) throw fail('E_UNKNOWN_TURN', `Unknown turnId: ${turnId}`);
  st.why = 'collapsed';
  st.streaming = false;
  return state(turnId);
}

export function _reset() {
  turnStates.clear();
}

export const disclosure = {
  wrap,
  expand,
  collapse,
  state,
  _complete,
  _reset,
};

export default disclosure;
