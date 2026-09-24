// computer/action/index.js
// Phase 29 Scope A — public surface of the action space.
//
// Contract spellings:
//   action.space()                                  -> [action names] (frozen v1 order)
//   action.parse(vlmText)                           -> { action, args, raw }
//   action.serialize(action)                        -> vlmText (canonical tagged-point form)
//   action.normalize(coord, { modelSize, screenSize }) -> { x, y }
//
// Error codes declared by this scope:
//   E_UNKNOWN_ACTION    action name outside the frozen v1 vocabulary
//   E_MALFORMED_ACTION  input is not a well-formed action call / box literal
//   E_INVALID_ARGUMENT  missing arg, bad enum value, bad point, bad options

import { actionNames, actionSchema, ACTIONS, ACTION_SPACE_VERSION, SCROLL_DIRECTIONS } from './space.js';
import { parse, parseBoxLiteral, unescapeContent } from './parser.js';
import { serialize, escapeContent } from './serializer.js';
import { normalize, NORMALIZE_FORMULA } from './coordinate.js';
import { ComputerError } from '../errors.js';

export const ACTION_CODES = Object.freeze([
  'E_UNKNOWN_ACTION',
  'E_MALFORMED_ACTION',
  'E_INVALID_ARGUMENT',
]);

export const action = Object.freeze({
  /** Frozen v1 vocabulary in declaration order. */
  space() {
    return actionNames();
  },
  /** VLM text -> { action, args, raw }. */
  parse,
  /** Structured action -> canonical VLM text. */
  serialize,
  /** Model pixel space -> screen pixel space (declared formula). */
  normalize,
});

export {
  ACTIONS,
  ACTION_SPACE_VERSION,
  SCROLL_DIRECTIONS,
  actionSchema,
  parseBoxLiteral,
  unescapeContent,
  escapeContent,
  NORMALIZE_FORMULA,
  ComputerError,
};
