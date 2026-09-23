/**
 * JEXI OS — benchmarks/osworld/adapter.js
 *
 * Frozen OSWorld v1 action space (pyautogui shape) + the JEXI -> OSWorld
 * action bridge.
 *
 *   click        { x, y, button? }
 *   right_click  { x, y }
 *   double_click { x, y }
 *   drag         { from: {x,y}, to: {x,y} }
 *   hotkey       { keys: [string] }
 *   key_down     { key }
 *   key_up       { key }
 *   type         { text }
 *   scroll       { dx, dy }
 *   move         { x, y }
 *   wait         { seconds }
 *   screenshot   {}
 *   done         {}
 *
 * osw.adapter({ mode: 'coords' | 'grounding', computer }) ->
 *   { mode, step(observation, { task }?) -> { action, args, trace }, reset() }
 *
 * This is a TRANSLATOR + DISPATCHER, not a GUI stack. It consumes the
 * Phase 29 computer agent (computer/operators + computer/loop) READ-ONLY
 * through the injected `computer` handle — no VM, no display server, no
 * automation backend is implemented or launched here, and no Phase 29
 * file is imported or edited:
 *
 *   computer = {
 *     coords:    { propose({ task?, observation, history })
 *                    -> { action, args } },        // OSWorld-shape speaker
 *     grounding: { propose({ task?, observation, history })
 *                    -> { action, args } },        // JEXI Phase 29-shape speaker
 *     execute:   ({ action, args }) -> { ok, ... },// OPTIONAL operator face
 *   }
 *
 * mode semantics:
 * - 'coords'    -> the seam speaks OSWorld actions DIRECTLY (deterministic
 *   tests; a scripted policy or an external agent's output). The adapter
 *   validates each proposal against the frozen v1 space and returns it.
 * - 'grounding' -> the seam speaks JEXI Phase 29 actions (the visual-
 *   grounding path: capture -> vlm.infer -> action.parse -> normalize,
 *   delivering SCREEN-space parsed actions — integral points, boxes already
 *   reduced to centers by the Phase 29 parser). The adapter TRANSLATES
 *   JEXI -> OSWorld through the frozen mapping below, then validates the
 *   translated action against the frozen space. The arbitration is visible
 *   in the trace: locate('vlm') -> from(JEXI) -> to(OSWorld) -> the
 *   translated action is what the computer executes.
 *
 * Frozen JEXI -> OSWorld mapping (v1):
 *   click        { start_box }              -> click        { x, y }
 *   right_single { start_box }              -> right_click  { x, y }
 *   left_double  { start_box }              -> double_click { x, y }
 *   drag         { start_box, end_box }     -> drag         { from, to }
 *   hotkey       { key }                    -> hotkey       { keys: key.split('+') }
 *   type         { content }                -> type         { text }
 *   scroll       { start_box, direction }   -> scroll       { dx, dy }
 *                (up -> {0,-SCROLL_STEP}, down -> {0,+SCROLL_STEP},
 *                 left -> {-SCROLL_STEP,0}, right -> {+SCROLL_STEP,0};
 *                 start_box is DROPPED — the OSWorld v1 scroll carries
 *                 deltas only)
 *   wait         {}                         -> wait         { seconds: WAIT_DEFAULT_SECONDS }
 *                (JEXI wait carries no duration; the bridge emits the frozen
 *                 neutral default)
 *   finished     { content? }               -> done         {}
 *                (content is DROPPED — the OSWorld done carries no payload;
 *                 the proposal is preserved in trace.from)
 *
 * OSWorld-only actions (key_down, key_up, move, screenshot) are valid
 * frozen-space outputs a coords-mode speaker may emit; the JEXI bridge
 * never produces them (Phase 29 v1 has no press/hold or bare-move
 * primitive, and the screenshot is the loop's capture, not an action).
 *
 * Validation, in order:
 * 1. action name outside the relevant frozen space -> E_UNKNOWN_ACTION
 *    (coords: the OSWorld v1 vocabulary; grounding: the Phase 29 v1
 *    vocabulary);
 * 2. missing/extra/ill-typed args                   -> E_INVALID_ARGUMENT
 *    (grounding: non-integer or negative screen coordinates are rejected —
 *    the grounding arm delivers normalize() output, which is integral).
 *
 * When computer.execute is a function, the validated action is dispatched
 * to it and its verdict is RECORDED VERBATIM in trace.executed (the
 * operator face obeys Phase 29's own contract: environment failures are
 * RETURNED as { ok: false, error }, misuse throws; the bridge does not
 * swallow, transform, or retry either one — it is not the executor).
 *
 * step() normalizes its input through osw.observe() first (idempotent on
 * already-parsed observations). The adapter owns an episode history (input
 * to the arms; first call sees []) and exposes reset() — run() resets
 * between runs. No wall-clock, no randomness: deterministic given
 * deterministic arms.
 */

import { observe } from './observation.js';

export const ACTION_SPACE_VERSION = 'v1';

export const ACTION_SPACE = Object.freeze({
  click: Object.freeze({ args: Object.freeze({ x: 'required non-negative integer', y: 'required non-negative integer', button: "optional, 'left' | 'middle' | 'right'" }) }),
  right_click: Object.freeze({ args: Object.freeze({ x: 'required non-negative integer', y: 'required non-negative integer' }) }),
  double_click: Object.freeze({ args: Object.freeze({ x: 'required non-negative integer', y: 'required non-negative integer' }) }),
  drag: Object.freeze({ args: Object.freeze({ from: 'required { x, y } non-negative integers', to: 'required { x, y } non-negative integers' }) }),
  hotkey: Object.freeze({ args: Object.freeze({ keys: 'required non-empty array of non-empty key names' }) }),
  key_down: Object.freeze({ args: Object.freeze({ key: 'required non-empty string' }) }),
  key_up: Object.freeze({ args: Object.freeze({ key: 'required non-empty string' }) }),
  type: Object.freeze({ args: Object.freeze({ text: 'required non-empty string' }) }),
  scroll: Object.freeze({ args: Object.freeze({ dx: 'required integer', dy: 'required integer' }) }),
  move: Object.freeze({ args: Object.freeze({ x: 'required non-negative integer', y: 'required non-negative integer' }) }),
  wait: Object.freeze({ args: Object.freeze({ seconds: 'required positive number' }) }),
  screenshot: Object.freeze({ args: Object.freeze({}) }),
  done: Object.freeze({ args: Object.freeze({}) }),
});

/** The JEXI Phase 29 v1 vocabulary the grounding arm speaks (mirror of
 *  computer/action/space.js — the adapter imports NOTHING from Phase 29;
 *  this table exists only to name the expected proposal shape and to
 *  reject unknown names with the right error). */
export const JEXI_PHASE29_SPACE = Object.freeze([
  'click',
  'left_double',
  'right_single',
  'drag',
  'hotkey',
  'type',
  'scroll',
  'wait',
  'finished',
]);

/** Bridge constants (frozen): the JEXI scroll carries a direction and no
 *  magnitude; the JEXI wait carries no duration. The bridge emits these
 *  neutral payloads so the OSWorld shapes are satisfied deterministically. */
export const SCROLL_STEP = 1;
export const WAIT_DEFAULT_SECONDS = 1;

const JEXI_SCROLL_DELTAS = Object.freeze({
  up: Object.freeze({ dx: 0, dy: -SCROLL_STEP }),
  down: Object.freeze({ dx: 0, dy: SCROLL_STEP }),
  left: Object.freeze({ dx: -SCROLL_STEP, dy: 0 }),
  right: Object.freeze({ dx: SCROLL_STEP, dy: 0 }),
});

const MOUSE_BUTTONS = Object.freeze(['left', 'middle', 'right']);
const MODES = Object.freeze(['coords', 'grounding']);

function unknownActionError(space, got) {
  const err = new Error(
    `E_UNKNOWN_ACTION — ${got} is not part of the frozen ${space} action space ` +
    (space === 'OSWorld v1'
      ? '(click | right_click | double_click | drag | hotkey | key_down | key_up | type | scroll | move | wait | screenshot | done)'
      : `(Phase 29 v1: ${JEXI_PHASE29_SPACE.join(' | ')})`)
  );
  err.code = 'E_UNKNOWN_ACTION';
  return err;
}

function argError(action, field, message) {
  const err = new Error(`E_INVALID_ARGUMENT — ${action}.${field}: ${message}`);
  err.code = 'E_INVALID_ARGUMENT';
  err.field = field;
  return err;
}

function describeGot(p) {
  if (p === null) return 'null';
  if (p === undefined) return 'undefined';
  if (Array.isArray(p)) return 'array';
  if (typeof p === 'string') return JSON.stringify(p);
  if (typeof p === 'object') {
    return `object with action=${typeof p.action === 'string' ? JSON.stringify(p.action) : 'non-string'}`;
  }
  return typeof p;
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Validate one OSWorld-shape proposal { action, args } against the frozen
 * v1 space. Returns { valid } or { valid: false, errors[] } — never throws.
 */
export function validateAction(proposed) {
  if (!isPlainObject(proposed)) {
    return { valid: false, errors: [unknownActionError('OSWorld v1', describeGot(proposed))] };
  }
  const name = proposed.action;
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(ACTION_SPACE, name)) {
    return { valid: false, errors: [unknownActionError('OSWorld v1', describeGot(proposed))] };
  }

  const errors = [];
  let args = proposed.args ?? {};
  if (!isPlainObject(args)) {
    errors.push(argError(name, 'args', 'args must be an object'));
    return { valid: false, errors };
  }
  const keys = Object.keys(args);
  const noExtra = (allowed) => {
    for (const k of keys) {
      if (!allowed.includes(k)) {
        errors.push(argError(name, k, `unknown argument (frozen ${ACTION_SPACE_VERSION}: ${name} carries ${allowed.length ? allowed.join(', ') : 'nothing'})`));
      }
    }
  };
  const point = (v, label) => {
    if (!isPlainObject(v)) {
      errors.push(argError(name, label, 'must be an object { x, y }'));
      return;
    }
    for (const axis of ['x', 'y']) {
      if (!Number.isInteger(v[axis]) || v[axis] < 0) {
        errors.push(argError(name, `${label}.${axis}`, 'must be a non-negative integer'));
      }
    }
    for (const k of Object.keys(v)) {
      if (k !== 'x' && k !== 'y') {
        errors.push(argError(name, `${label}.${k}`, 'unknown axis (point carries x, y only)'));
      }
    }
  };
  const coord = (axis) => {
    if (!Number.isInteger(args[axis]) || args[axis] < 0) {
      errors.push(argError(name, axis, 'must be a non-negative integer'));
    }
  };

  if (name === 'screenshot' || name === 'done') {
    noExtra([]);
  } else if (name === 'click') {
    coord('x');
    coord('y');
    if (args.button !== undefined && !MOUSE_BUTTONS.includes(args.button)) {
      errors.push(argError(name, 'button', `button must be one of ${MOUSE_BUTTONS.join(' | ')} when present`));
    }
    noExtra(['x', 'y', 'button']);
  } else if (name === 'right_click' || name === 'double_click' || name === 'move') {
    coord('x');
    coord('y');
    noExtra(['x', 'y']);
  } else if (name === 'drag') {
    point(args.from, 'from');
    point(args.to, 'to');
    noExtra(['from', 'to']);
  } else if (name === 'hotkey') {
    if (!Array.isArray(args.keys) || args.keys.length === 0) {
      errors.push(argError(name, 'keys', 'keys must be a non-empty array of key names'));
    } else {
      args.keys.forEach((k, i) => {
        if (typeof k !== 'string' || k === '') {
          errors.push(argError(name, `keys[${i}]`, 'key name must be a non-empty string'));
        }
      });
    }
    noExtra(['keys']);
  } else if (name === 'key_down' || name === 'key_up') {
    if (typeof args.key !== 'string' || args.key === '') {
      errors.push(argError(name, 'key', 'key must be a non-empty string'));
    }
    noExtra(['key']);
  } else if (name === 'type') {
    if (typeof args.text !== 'string' || args.text === '') {
      errors.push(argError(name, 'text', 'text must be a non-empty string'));
    }
    noExtra(['text']);
  } else if (name === 'scroll') {
    for (const axis of ['dx', 'dy']) {
      if (!Number.isInteger(args[axis])) {
        errors.push(argError(name, axis, 'must be an integer'));
      }
    }
    noExtra(['dx', 'dy']);
  } else if (name === 'wait') {
    if (typeof args.seconds !== 'number' || !Number.isFinite(args.seconds) || args.seconds <= 0) {
      errors.push(argError(name, 'seconds', 'seconds must be a positive finite number'));
    }
    noExtra(['seconds']);
  }

  return errors.length ? { valid: false, errors } : { valid: true };
}

/* ---------------------------------------------------------------------- *
 * JEXI (Phase 29 v1) -> OSWorld (v1) translation
 * ---------------------------------------------------------------------- */

/** Coerce a JEXI box arg into a point { x, y }. Mirrors the Phase 29
 *  parser's declared semantics: a tagged point or a bracket box (reduced
 *  to its Math.round center at parse time). The bridge accepts the
 *  structured forms {x,y} | [x,y] | [x1,y1,x2,y2] and requires INTEGRAL
 *  non-negative points — the grounding arm delivers normalize() output,
 *  which is integral; anything else is fail-closed. */
function coercePoint(value, action, field) {
  if (Array.isArray(value)) {
    if (value.length === 2) {
      const [x, y] = value;
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
        throw argError(action, field, `point [${value.join(', ')}] must carry non-negative integers`);
      }
      return { x, y };
    }
    if (value.length === 4) {
      const [x1, y1, x2, y2] = value;
      for (const v of [x1, y1, x2, y2]) {
        if (!Number.isInteger(v) || v < 0) {
          throw argError(action, field, `box [${value.join(', ')}] must carry non-negative integers`);
        }
      }
      return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
    }
    throw argError(action, field, `expected [x, y] or [x1, y1, x2, y2], got length ${value.length}`);
  }
  if (isPlainObject(value)) {
    const extra = Object.keys(value).filter((k) => k !== 'x' && k !== 'y');
    if (extra.length) throw argError(action, `${field}.${extra[0]}`, 'unknown axis (point carries x, y only)');
    const { x, y } = value;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
      throw argError(action, field, `point (${JSON.stringify(value)}) must carry non-negative integers`);
    }
    return { x, y };
  }
  throw argError(action, field, 'must be a point { x, y } | [x, y] | [x1, y1, x2, y2] (Phase 29 box semantics)');
}

function jexiArgsError(action, field, message) {
  const err = new Error(`E_INVALID_ARGUMENT — JEXI ${action}.${field}: ${message}`);
  err.code = 'E_INVALID_ARGUMENT';
  err.field = field;
  return err;
}

function jexiNoExtra(action, args, allowed) {
  for (const k of Object.keys(args)) {
    if (!allowed.includes(k)) {
      throw jexiArgsError(action, k, `unknown argument (frozen Phase 29 v1: ${action} carries ${allowed.length ? allowed.join(', ') : 'nothing'})`);
    }
  }
}

/** Translate one JEXI Phase 29-shape proposal into an OSWorld-shape
 *  action through the frozen v1 mapping. Throws E_UNKNOWN_ACTION (name
 *  outside the Phase 29 vocabulary) and E_INVALID_ARGUMENT (ill-typed
 *  JEXI args, including a JEXI-legal shape with no OSWorld counterpart,
 *  e.g. an empty type content). */
export function translateJexi(proposed) {
  if (!isPlainObject(proposed)) {
    throw unknownActionError('Phase 29 v1', describeGot(proposed));
  }
  const name = proposed.action;
  if (typeof name !== 'string' || !JEXI_PHASE29_SPACE.includes(name)) {
    throw unknownActionError('Phase 29 v1', describeGot(proposed));
  }
  const args = proposed.args ?? {};
  if (!isPlainObject(args)) {
    throw jexiArgsError(name, 'args', 'args must be an object');
  }

  switch (name) {
    case 'click':
    case 'right_single':
    case 'left_double': {
      jexiNoExtra(name, args, ['start_box']);
      if (args.start_box === undefined) throw jexiArgsError(name, 'start_box', 'start_box is required');
      const p = coercePoint(args.start_box, name, 'start_box');
      const osWorldName =
        name === 'click' ? 'click' : name === 'right_single' ? 'right_click' : 'double_click';
      return { action: osWorldName, args: { x: p.x, y: p.y } };
    }
    case 'drag': {
      jexiNoExtra(name, args, ['start_box', 'end_box']);
      if (args.start_box === undefined) throw jexiArgsError(name, 'start_box', 'start_box is required');
      if (args.end_box === undefined) throw jexiArgsError(name, 'end_box', 'end_box is required');
      const from = coercePoint(args.start_box, name, 'start_box');
      const to = coercePoint(args.end_box, name, 'end_box');
      return { action: 'drag', args: { from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } } };
    }
    case 'hotkey': {
      jexiNoExtra(name, args, ['key']);
      if (typeof args.key !== 'string' || args.key === '') {
        throw jexiArgsError(name, 'key', 'key must be a non-empty string');
      }
      const keys = args.key.split('+').map((k) => k.trim());
      if (keys.some((k) => k === '')) {
        throw jexiArgsError(name, 'key', `chord ${JSON.stringify(args.key)} splits on '+' into empty key names`);
      }
      return { action: 'hotkey', args: { keys } };
    }
    case 'type': {
      jexiNoExtra(name, args, ['content']);
      if (typeof args.content !== 'string') {
        throw jexiArgsError(name, 'content', 'content must be a string');
      }
      if (args.content === '') {
        throw jexiArgsError(name, 'content', 'empty content has no OSWorld counterpart (frozen v1 type requires non-empty text)');
      }
      return { action: 'type', args: { text: args.content } };
    }
    case 'scroll': {
      jexiNoExtra(name, args, ['start_box', 'direction']);
      if (args.start_box === undefined) throw jexiArgsError(name, 'start_box', 'start_box is required');
      coercePoint(args.start_box, name, 'start_box'); // validated, then dropped (OSWorld v1 scroll carries deltas only)
      if (!JEXI_SCROLL_DELTAS[args.direction]) {
        throw jexiArgsError(name, 'direction', `direction must be one of ${Object.keys(JEXI_SCROLL_DELTAS).join(' | ')}`);
      }
      return { action: 'scroll', args: { ...JEXI_SCROLL_DELTAS[args.direction] } };
    }
    case 'wait': {
      jexiNoExtra(name, args, []);
      return { action: 'wait', args: { seconds: WAIT_DEFAULT_SECONDS } };
    }
    case 'finished': {
      jexiNoExtra(name, args, ['content']);
      if (args.content !== undefined && typeof args.content !== 'string') {
        throw jexiArgsError(name, 'content', 'content must be a string when present');
      }
      return { action: 'done', args: {} }; // content dropped (declared); the proposal stays visible in trace.from
    }
    default:
      throw unknownActionError('Phase 29 v1', JSON.stringify(name));
  }
}

function computerArmError(what) {
  const err = new Error(
    `OSW_COMPUTER_REQUIRED — computer.${what} is required: the adapter consumes the ` +
    'Phase 29 computer agent (computer/operators + computer/loop) READ-ONLY through the ' +
    'injected computer handle; it never implements or launches a GUI stack itself.'
  );
  err.code = 'OSW_COMPUTER_REQUIRED';
  return err;
}

/**
 * Build an adapter bound to one mode + computer handle. Throws
 * E_INVALID_ARGUMENT on a mode outside the frozen set and
 * OSW_COMPUTER_REQUIRED when the mode's arm is missing.
 */
export function createAdapter({ mode = 'coords', computer } = {}) {
  if (!MODES.includes(mode)) {
    const err = new Error(
      `E_INVALID_ARGUMENT — adapter mode must be ${MODES.map((m) => `'${m}'`).join(' | ')} (got ${JSON.stringify(mode ?? null)})`
    );
    err.code = 'E_INVALID_ARGUMENT';
    throw err;
  }
  if (!isPlainObject(computer)) throw computerArmError(mode === 'coords' ? 'coords.propose' : 'grounding.propose');
  if (mode === 'coords' && typeof computer.coords?.propose !== 'function') throw computerArmError('coords.propose');
  if (mode === 'grounding' && typeof computer.grounding?.propose !== 'function') {
    throw computerArmError('grounding.propose');
  }

  let history = [];

  return {
    mode,

    async step(input, { task } = {}) {
      const observation = observe(input);
      const armInput = {
        ...(task !== undefined ? { task } : {}),
        observation,
        history,
      };

      let action;
      let args;
      let trace;
      if (mode === 'coords') {
        const proposed = await computer.coords.propose(armInput);
        const verdict = validateAction(proposed);
        if (!verdict.valid) throw verdict.errors[0];
        action = proposed.action;
        args = proposed.args ?? {};
        trace = { arm: 'coords' };
      } else {
        const proposed = await computer.grounding.propose(armInput);
        const translated = translateJexi(proposed); // JEXI-shape validation + frozen mapping
        const verdict = validateAction(translated); // defensive: the mapping is total over valid JEXI inputs
        if (!verdict.valid) throw verdict.errors[0];
        action = translated.action;
        args = translated.args;
        trace = {
          arm: 'grounding',
          locate: 'vlm',
          execute: 'computer',
          from: { action: proposed.action, args: proposed.args },
          to: { action, args },
        };
      }

      if (typeof computer.execute === 'function') {
        trace.executed = await computer.execute({ action, args }); // operator face — recorded verbatim
      }

      history.push({ observation, action, args });
      return { action, args, trace };
    },

    reset() {
      history = [];
    },
  };
}
