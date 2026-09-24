// computer/action/parser.js
// Phase 29 Scope A — VLM text -> structured action.
//
// Input is one action call as emitted by a UI-TARS-style VLM, e.g.
//   click(start_box='<|box_start|>(100,200)<|box_end|>')
//   click(start_box='[740,30,860,90]')          // bracket box -> center
//   drag(start_box='<|box_start|>(1,2)<|box_end|>', end_box='<|box_start|>(3,4)<|box_end|>')
//   type(content='it\'s a \"test\"\nline2')
//
// Declared behavior:
// - Unknown action name            -> E_UNKNOWN_ACTION (never passed through)
// - Text is not an action call at  -> E_MALFORMED_ACTION
//   all (no name(...) shape)
// - Box literal matches neither    -> E_MALFORMED_ACTION (syntax failure)
//   accepted form
// - Missing required arg / bad     -> E_INVALID_ARGUMENT (semantic failure)
//   enum value / empty key / bad
//   structured action object
// - Bracket box [x1,y1,x2,y2] is normalized to its center point at parse
//   time: cx = round((x1+x2)/2), cy = round((y1+y2)/2). One-way: parsed
//   args always carry points, never raw boxes (declared).
// - Coordinates are returned in MODEL pixel space, verbatim. Mapping to
//   screen pixels is a separate, explicit step (coordinate.normalize).
// - No clock, no randomness: same input -> same output, always.

import { ComputerError } from '../errors.js';
import { ACTIONS, SCROLL_DIRECTIONS } from './space.js';

// Accepted box form 1: <|box_start|>(x,y)<|box_end|>   (point)
const TAGGED_POINT =
  /^<\|box_start\|>\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s*<\|box_end\|>$/;
// Accepted box form 2: [x1,y1,x2,y2]                   (box -> center)
const BRACKET_BOX =
  /^\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]$/;

// key='value' pairs; value may contain backslash escapes and raw newlines.
const PAIR = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*'((?:\\[\s\S]|[^'\\])*)'/g;

const CALL_SHAPE = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;

/**
 * Unescape a 'text'-kind value (TARS type() discipline).
 * Recognized escapes: \n newline, \' quote, \" double quote, \\ backslash.
 * An unrecognized escape keeps the backslash + next char verbatim
 * (declared, deterministic).
 */
export function unescapeContent(s) {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      const n = s[i + 1];
      if (n === 'n') { out += '\n'; i += 1; continue; }
      if (n === "'") { out += "'"; i += 1; continue; }
      if (n === '"') { out += '"'; i += 1; continue; }
      if (n === '\\') { out += '\\'; i += 1; continue; }
      out += c; // keep the backslash; next char is handled next iteration
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * Parse a box literal into a point. Returns {x, y} or null if the literal
 * matches neither accepted form.
 */
export function parseBoxLiteral(value) {
  const tp = TAGGED_POINT.exec(value);
  if (tp) return { x: Number(tp[1]), y: Number(tp[2]) };
  const bb = BRACKET_BOX.exec(value);
  if (bb) {
    const x1 = Number(bb[1]);
    const y1 = Number(bb[2]);
    const x2 = Number(bb[3]);
    const y2 = Number(bb[4]);
    return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
  }
  return null;
}

/**
 * Parse one VLM action call.
 * @param {string} text
 * @returns {{ action: string, args: object, raw: string }}
 */
export function parse(text) {
  if (typeof text !== 'string') {
    throw new ComputerError('E_MALFORMED_ACTION', 'action input must be a string', {
      got: typeof text,
    });
  }
  const trimmed = text.trim();
  const shape = CALL_SHAPE.exec(trimmed);
  if (!shape) {
    throw new ComputerError('E_MALFORMED_ACTION', 'input is not an action call', {
      input: text,
    });
  }
  const name = shape[1];
  const schema = ACTIONS[name];
  if (!schema) {
    throw new ComputerError('E_UNKNOWN_ACTION', `unknown action: ${name}`, {
      action: name,
      known: Object.keys(ACTIONS),
    });
  }

  const open = trimmed.indexOf('(');
  const close = trimmed.lastIndexOf(')');
  if (close <= open) {
    throw new ComputerError('E_MALFORMED_ACTION', 'unterminated action call', {
      action: name,
      input: text,
    });
  }
  const inner = trimmed.slice(open + 1, close);

  const pairs = new Map();
  let m;
  PAIR.lastIndex = 0;
  while ((m = PAIR.exec(inner)) !== null) {
    if (pairs.has(m[1])) {
      throw new ComputerError('E_MALFORMED_ACTION', `duplicate argument: ${m[1]}`, {
        action: name,
        arg: m[1],
      });
    }
    pairs.set(m[1], m[2]);
  }

  // Unknown arg keys are rejected, not ignored (declared).
  for (const key of pairs.keys()) {
    if (!(key in schema.args)) {
      throw new ComputerError('E_INVALID_ARGUMENT', `unknown argument for ${name}: ${key}`, {
        action: name,
        arg: key,
        accepted: Object.keys(schema.args),
      });
    }
  }

  // Missing required args are rejected.
  for (const [key, spec] of Object.entries(schema.args)) {
    if (!spec.optional && !pairs.has(key)) {
      throw new ComputerError('E_INVALID_ARGUMENT', `missing argument for ${name}: ${key}`, {
        action: name,
        arg: key,
      });
    }
  }

  // Build args in schema declaration order (deterministic key order).
  const args = {};
  for (const [key, spec] of Object.entries(schema.args)) {
    const present = pairs.has(key);
    if (!present) {
      args[key] = spec.default; // only reached for optional args
      continue;
    }
    const rawVal = pairs.get(key);
    switch (spec.kind) {
      case 'box': {
        const pt = parseBoxLiteral(rawVal);
        if (!pt) {
          throw new ComputerError(
            'E_MALFORMED_ACTION',
            `unparseable box literal for ${name}.${key}`,
            { action: name, arg: key, value: rawVal, accepted: ['<|box_start|>(x,y)<|box_end|>', '[x1,y1,x2,y2]'] }
          );
        }
        args[key] = pt;
        break;
      }
      case 'string': {
        if (rawVal.length < (spec.minLength ?? 0)) {
          throw new ComputerError('E_INVALID_ARGUMENT', `empty argument for ${name}: ${key}`, {
            action: name,
            arg: key,
          });
        }
        args[key] = rawVal;
        break;
      }
      case 'text': {
        args[key] = unescapeContent(rawVal);
        break;
      }
      case 'enum': {
        if (!spec.values.includes(rawVal)) {
          throw new ComputerError('E_INVALID_ARGUMENT', `invalid value for ${name}.${key}: ${rawVal}`, {
            action: name,
            arg: key,
            value: rawVal,
            accepted: spec.values,
          });
        }
        args[key] = rawVal;
        break;
      }
      default:
        throw new ComputerError('E_INVALID_ARGUMENT', `undeclared arg kind for ${name}.${key}`, {
          action: name,
          arg: key,
          kind: spec.kind,
        });
    }
  }

  return { action: name, args, raw: text };
}
