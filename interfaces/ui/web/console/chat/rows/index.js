/**
 * JEXI OS — Phase 16 Scope C — Row Taxonomy Renderer
 *
 * Every chat event maps to exactly ONE row type.
 * No freeform rendering. No silent fallback.
 *
 * EVENT -> ROW MAPPING (from spec):
 *  message.delta      -> text
 *  thinking.delta     -> thinking
 *  narration.line     -> narration
 *  tool.started       -> tool-use
 *  tool.progress      -> tool-use
 *  tool.completed     -> tool-result
 *  tool.failed        -> tool-error
 *  approval.requested -> approval
 *  approval.resolved  -> approval
 *  agent.spawned      -> agent
 *  agent.completed    -> agent
 *  turn.completed     -> turn-end-ok (or turn-end-fail when payload.success===false or status==='fail')
 *  plan.created       -> text
 *  plan.updated       -> text
 *  artifact.created   -> text
 *  checkpoint.created -> text
 *
 * Styles inlined from src/styles/jexi-theme.css (Phase 6F):
 *  --jcx-ink:#f3eee6, --jcx-ink-2:#a99f90, --jcx-ink-3:#7a7163,
 *  --jcx-ember:#ff7a3d, --jcx-peach:#ffb88c, --jcx-coral:#ff6b5e,
 *  --jcx-gold:#e5b567, --jcx-up:#4cc38a, --jcx-down:#ff5d5d
 *
 * Contract:
 *  rows.render(event) -> { rowType, content, style }
 *  rows.styles(rowType) -> { color, weight, italic, monospace }
 *  rows.list() -> all supported row types
 */

import * as text from './text.js';
import * as thinking from './thinking.js';
import * as narration from './narration.js';
import * as toolUse from './tool-use.js';
import * as toolResult from './tool-result.js';
import * as toolError from './tool-error.js';
import * as approval from './approval.js';
import * as agent from './agent.js';
import * as turnEndOk from './turn-end-ok.js';
import * as turnEndFail from './turn-end-fail.js';

const ROW_MODULES = {
  'text': text,
  'thinking': thinking,
  'narration': narration,
  'tool-use': toolUse,
  'tool-result': toolResult,
  'tool-error': toolError,
  'approval': approval,
  'agent': agent,
  'turn-end-ok': turnEndOk,
  'turn-end-fail': turnEndFail,
};

const ROW_TYPES = Object.keys(ROW_MODULES);

// Event -> Row mapping (spec)
const EVENT_TO_ROW = {
  'message.delta': 'text',
  'thinking.delta': 'thinking',
  'narration.line': 'narration',
  'tool.started': 'tool-use',
  'tool.progress': 'tool-use',
  'tool.completed': 'tool-result',
  'tool.failed': 'tool-error',
  'approval.requested': 'approval',
  'approval.resolved': 'approval',
  'agent.spawned': 'agent',
  'agent.completed': 'agent',
  'turn.completed': 'turn-end-ok', // special-cased for fail
  'plan.created': 'text',
  'plan.updated': 'text',
  'artifact.created': 'text',
  'checkpoint.created': 'text',
};

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

export function list() {
  return [...ROW_TYPES];
}

export function styles(rowType) {
  if (!ROW_TYPES.includes(rowType)) {
    throw fail('E_UNMAPPED_EVENT', `Unknown rowType: ${rowType}`);
  }
  const mod = ROW_MODULES[rowType];
  // Return copy to keep pure
  return { ...mod.style };
}

export function render(event) {
  if (!event || typeof event.type !== 'string') {
    throw fail('E_UNMAPPED_EVENT', 'event.type missing or not string');
  }

  // Check if event type is known mapping
  if (!(event.type in EVENT_TO_ROW)) {
    throw fail('E_UNMAPPED_EVENT', `Unmapped event type: ${event.type}`);
  }

  let rowType = EVENT_TO_ROW[event.type];

  // Special case: turn.completed with success===false or status==='fail' -> turn-end-fail
  if (event.type === 'turn.completed') {
    const p = event.payload || {};
    if (p.success === false || p.status === 'fail') {
      rowType = 'turn-end-fail';
    } else {
      rowType = 'turn-end-ok';
    }
  }

  const mod = ROW_MODULES[rowType];
  if (!mod) {
    throw fail('E_UNMAPPED_EVENT', `No module for rowType: ${rowType}`);
  }

  // Pure render — no side effects
  const content = mod.render(event);
  const style = { ...mod.style };

  // Deterministic output — same event -> byte-identical render (pure)
  return {
    rowType,
    content,
    style,
  };
}

// Also export mapping for verification
export const mapping = { ...EVENT_TO_ROW };

export const rows = {
  render,
  styles,
  list,
  mapping,
  ROW_TYPES,
};

export default rows;
