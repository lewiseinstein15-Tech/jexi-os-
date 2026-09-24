// computer/action/serializer.js
// Phase 29 Scope A — structured action -> VLM text (canonical form).
//
// Canonical output uses the tagged point form exclusively:
//   click(start_box='<|box_start|>(x,y)<|box_end|>')
//   drag(start_box='<|box_start|>(x1,y1)<|box_end|>', end_box='<|box_start|>(x2,y2)<|box_end|>')
//   scroll(start_box='<|box_start|>(x,y)<|box_end|>', direction='down')
//   hotkey(key='ctrl+c')
//   type(content='escaped \' \" \\n text')
//   wait()
//   finished(content='done')
//
// Declared behavior:
// - Escape order for 'text' values: backslash first, then ', then ", then
//   newline (so the round trip is exact).
// - Points must be finite numbers; integers print without a decimal part,
//   floats print as-is. No clamping or rounding here — the value was
//   already normalized (or intentionally not) upstream.
// - Unknown action -> E_UNKNOWN_ACTION; missing/bad args -> E_INVALID_ARGUMENT.
// - Deterministic: fixed key order (schema order), no clock, no randomness.

import { ComputerError } from '../errors.js';
import { ACTIONS, SCROLL_DIRECTIONS } from './space.js';

export function escapeContent(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function pointTag(pt, actionName, argName) {
  if (
    pt === null ||
    typeof pt !== 'object' ||
    typeof pt.x !== 'number' ||
    typeof pt.y !== 'number' ||
    !Number.isFinite(pt.x) ||
    !Number.isFinite(pt.y)
  ) {
    throw new ComputerError('E_INVALID_ARGUMENT', `bad point for ${actionName}.${argName}`, {
      action: actionName,
      arg: argName,
      got: pt,
    });
  }
  return `<|box_start|>(${pt.x},${pt.y})<|box_end|>`;
}

function requireString(v, actionName, argName, minLength = 0) {
  if (typeof v !== 'string' || v.length < minLength) {
    throw new ComputerError('E_INVALID_ARGUMENT', `bad string for ${actionName}.${argName}`, {
      action: actionName,
      arg: argName,
      got: v,
    });
  }
  return v;
}

/**
 * Serialize a structured action to canonical VLM text.
 * @param {{ action: string, args: object }} action
 * @returns {string}
 */
export function serialize(action) {
  if (!action || typeof action !== 'object' || typeof action.action !== 'string') {
    throw new ComputerError('E_INVALID_ARGUMENT', 'serialize expects { action, args }', {
      got: action,
    });
  }
  const name = action.action;
  const schema = ACTIONS[name];
  if (!schema) {
    throw new ComputerError('E_UNKNOWN_ACTION', `unknown action: ${name}`, {
      action: name,
      known: Object.keys(ACTIONS),
    });
  }
  const args = action.args ?? {};
  // Reject unknown keys on serialize too (symmetric with parse).
  for (const key of Object.keys(args)) {
    if (!(key in schema.args)) {
      throw new ComputerError('E_INVALID_ARGUMENT', `unknown argument for ${name}: ${key}`, {
        action: name,
        arg: key,
        accepted: Object.keys(schema.args),
      });
    }
  }

  switch (name) {
    case 'click':
    case 'left_double':
    case 'right_single':
      return `${name}(start_box='${pointTag(args.start_box, name, 'start_box')}')`;
    case 'drag':
      return `drag(start_box='${pointTag(args.start_box, name, 'start_box')}', end_box='${pointTag(args.end_box, name, 'end_box')}')`;
    case 'scroll': {
      const dir = requireString(args.direction, name, 'direction');
      if (!SCROLL_DIRECTIONS.includes(dir)) {
        throw new ComputerError('E_INVALID_ARGUMENT', `invalid scroll direction: ${dir}`, {
          action: name,
          arg: 'direction',
          value: dir,
          accepted: SCROLL_DIRECTIONS,
        });
      }
      return `scroll(start_box='${pointTag(args.start_box, name, 'start_box')}', direction='${dir}')`;
    }
    case 'hotkey':
      return `hotkey(key='${requireString(args.key, name, 'key', 1)}')`;
    case 'type':
      return `type(content='${escapeContent(requireString(args.content, name, 'content'))}')`;
    case 'wait':
      return 'wait()';
    case 'finished':
      return `finished(content='${escapeContent(args.content ?? '')}')`;
    default:
      // Unreachable while ACTIONS is frozen and exhaustive above.
      throw new ComputerError('E_UNKNOWN_ACTION', `unhandled action: ${name}`, { action: name });
  }
}
