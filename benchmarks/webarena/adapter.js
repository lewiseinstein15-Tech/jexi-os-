/**
 * JEXI OS — benchmarks/webarena/adapter.js
 *
 * Frozen WebArena v1 action space + the JEXI -> WebArena action bridge.
 *
 *   noop       {}
 *   click      { element_id }
 *   type       { element_id, text, press_enter? }
 *   scroll     { direction: 'up' | 'down' }
 *   hover      { element_id }
 *   press      { key_comb }
 *   tab_focus  { index }
 *   new_tab    {}
 *   tab_close  {}
 *   goto       { url }
 *
 * wa.adapter({ mode: 'dom' | 'visual' | 'hybrid', browser }) ->
 *   { mode, step(observation, { task }?) -> { action, args, trace }, reset() }
 *
 * This is a TRANSLATOR + DISPATCHER, not a browser. It consumes the
 * Phase 17 browser runtime (DOM arm) and the Phase 29 computer agent
 * (visual arm) READ-ONLY through the injected `browser` handle — no
 * browser is implemented or launched here, no Phase 17/29 file is
 * imported or edited:
 *
 *   browser = {
 *     dom:    { propose({ task?, observation, history }) -> { action, args } },
 *     visual: { ground ({ task?, observation, history }) -> { action, args } },
 *   }
 *
 * mode semantics:
 * - 'dom'    -> Phase 17 DOM arm only: browser.dom.propose decides;
 * - 'visual' -> Phase 29 visual grounding only: browser.visual.ground decides;
 * - 'hybrid' -> Phase 29 hybrid (VLM + DOM confirm): the visual arm
 *   LOCATES (proposes), the adapter CONFIRMS against the observation's
 *   accessibility tree (the DOM ground truth), and the confirmed action
 *   is what the runner EXECUTES on the DOM side. Element-bearing
 *   proposals that fail the confirm are fail-closed: E_UNKNOWN_ELEMENT.
 *
 * Validation, in order:
 * 1. action name outside the frozen space -> E_UNKNOWN_ACTION;
 * 2. missing/extra/ill-typed args        -> E_INVALID_ARGUMENT;
 * 3. element_id of click/type/hover not in the CURRENT observation
 *    -> E_UNKNOWN_ELEMENT (all modes; hybrid reports it as a failed
 *    DOM confirm).
 * step() normalizes its input through wa.observe() first (idempotent on
 * already-parsed observations).
 *
 * The adapter owns an episode history (input to the arms; first call
 * sees []) and exposes reset() — run() resets between tasks. No wall-
 * clock, no randomness: deterministic given deterministic arms.
 */

import { observe, elementSet } from './observation.js';

export const ACTION_SPACE_VERSION = 'v1';

export const ACTION_SPACE = Object.freeze({
  noop: Object.freeze({ args: Object.freeze({}) }),
  click: Object.freeze({ args: Object.freeze({ element_id: 'required non-empty string; must exist in the current observation' }) }),
  type: Object.freeze({ args: Object.freeze({ element_id: 'required non-empty string; must exist in the current observation', text: 'required non-empty string', press_enter: 'optional boolean' }) }),
  scroll: Object.freeze({ args: Object.freeze({ direction: "required, 'up' | 'down'" }) }),
  hover: Object.freeze({ args: Object.freeze({ element_id: 'required non-empty string; must exist in the current observation' }) }),
  press: Object.freeze({ args: Object.freeze({ key_comb: 'required non-empty string' }) }),
  tab_focus: Object.freeze({ args: Object.freeze({ index: 'required non-negative integer' }) }),
  new_tab: Object.freeze({ args: Object.freeze({}) }),
  tab_close: Object.freeze({ args: Object.freeze({}) }),
  goto: Object.freeze({ args: Object.freeze({ url: 'required non-empty string' }) }),
});

const ELEMENT_ACTIONS = Object.freeze(new Set(['click', 'type', 'hover']));
const MODES = Object.freeze(['dom', 'visual', 'hybrid']);

function unknownActionError(got) {
  const err = new Error(
    `E_UNKNOWN_ACTION — ${got} is not part of the frozen WebArena ${ACTION_SPACE_VERSION} action space ` +
    `(noop | click | type | scroll | hover | press | tab_focus | new_tab | tab_close | goto)`
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
 * Validate one action proposal { action, args } against the frozen v1
 * space (shape only — element existence is the adapter's job, since it
 * depends on the live observation). Returns { valid } or
 * { valid: false, errors[] } — never throws.
 */
export function validateAction(proposed) {
  if (!isPlainObject(proposed)) {
    return { valid: false, errors: [unknownActionError(describeGot(proposed))] };
  }
  const name = proposed.action;
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(ACTION_SPACE, name)) {
    return { valid: false, errors: [unknownActionError(describeGot(proposed))] };
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

  if (name === 'noop' || name === 'new_tab' || name === 'tab_close') {
    noExtra([]);
  } else if (name === 'click' || name === 'hover') {
    const id = args.element_id;
    if (typeof id !== 'string' || id === '') {
      errors.push(argError(name, 'element_id', 'element_id must be a non-empty string'));
    }
    noExtra(['element_id']);
  } else if (name === 'type') {
    const id = args.element_id;
    if (typeof id !== 'string' || id === '') {
      errors.push(argError(name, 'element_id', 'element_id must be a non-empty string'));
    }
    if (typeof args.text !== 'string' || args.text === '') {
      errors.push(argError(name, 'text', 'text must be a non-empty string'));
    }
    if (args.press_enter !== undefined && typeof args.press_enter !== 'boolean') {
      errors.push(argError(name, 'press_enter', 'press_enter must be a boolean when present'));
    }
    noExtra(['element_id', 'text', 'press_enter']);
  } else if (name === 'scroll') {
    if (args.direction !== 'up' && args.direction !== 'down') {
      errors.push(argError(name, 'direction', "direction must be 'up' | 'down'"));
    }
    noExtra(['direction']);
  } else if (name === 'press') {
    if (typeof args.key_comb !== 'string' || args.key_comb === '') {
      errors.push(argError(name, 'key_comb', 'key_comb must be a non-empty string'));
    }
    noExtra(['key_comb']);
  } else if (name === 'tab_focus') {
    if (typeof args.index !== 'number' || !Number.isInteger(args.index) || args.index < 0) {
      errors.push(argError(name, 'index', 'index must be a non-negative integer'));
    }
    noExtra(['index']);
  } else if (name === 'goto') {
    if (typeof args.url !== 'string' || args.url === '') {
      errors.push(argError(name, 'url', 'url must be a non-empty string'));
    }
    noExtra(['url']);
  }

  return errors.length ? { valid: false, errors } : { valid: true };
}

function armError(what) {
  const err = new Error(
    `WA_BROWSER_ARM_REQUIRED — browser.${what} is required: the adapter consumes the ` +
    'Phase 17 browser runtime (DOM arm) and Phase 29 computer agent (visual arm) READ-ONLY ' +
    'through the injected browser handle; it never implements or launches a browser itself.'
  );
  err.code = 'WA_BROWSER_ARM_REQUIRED';
  return err;
}

/**
 * Build an adapter bound to one mode + browser handle. Throws
 * E_INVALID_ARGUMENT on a mode outside the frozen set and
 * WA_BROWSER_ARM_REQUIRED when the mode's arm is missing.
 */
export function createAdapter({ mode = 'dom', browser } = {}) {
  if (!MODES.includes(mode)) {
    const err = new Error(
      `E_INVALID_ARGUMENT — adapter mode must be ${MODES.map((m) => `'${m}'`).join(' | ')} (got ${JSON.stringify(mode ?? null)})`
    );
    err.code = 'E_INVALID_ARGUMENT';
    throw err;
  }
  if (!isPlainObject(browser)) throw armError(mode === 'dom' ? 'dom.propose' : 'visual.ground');
  if (mode === 'dom' && typeof browser.dom?.propose !== 'function') throw armError('dom.propose');
  if ((mode === 'visual' || mode === 'hybrid') && typeof browser.visual?.ground !== 'function') {
    throw armError('visual.ground');
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

      let proposed;
      let trace;
      if (mode === 'dom') {
        proposed = await browser.dom.propose(armInput);
        trace = { arm: 'dom' };
      } else {
        // 'visual' and 'hybrid' both locate through the Phase 29 visual arm.
        proposed = await browser.visual.ground(armInput);
        trace =
          mode === 'visual'
            ? { arm: 'visual' }
            : { arm: 'hybrid', locate: 'visual', confirm: 'dom' };
      }

      const verdict = validateAction(proposed);
      if (!verdict.valid) throw verdict.errors[0];
      const action = proposed.action;
      const args = proposed.args ?? {};

      if (ELEMENT_ACTIONS.has(action)) {
        const known = elementSet(observation);
        const confirmed = known.has(args.element_id);
        if (mode === 'hybrid') trace.elementConfirmed = confirmed;
        if (!confirmed) {
          const err = new Error(
            `E_UNKNOWN_ELEMENT — ${action}.element_id ${JSON.stringify(args.element_id)} is not in the ` +
            `current observation's accessibility tree (${known.size} elements known` +
            (mode === 'hybrid' ? '); hybrid DOM-confirm rejected the visual arm proposal (fail-closed)' : ')')
          );
          err.code = 'E_UNKNOWN_ELEMENT';
          err.element_id = args.element_id;
          throw err;
        }
      } else if (mode === 'hybrid') {
        trace.elementConfirmed = null; // no element to confirm for this action
      }

      history.push({ observation, action, args });
      return { action, args, trace };
    },

    reset() {
      history = [];
    },
  };
}
