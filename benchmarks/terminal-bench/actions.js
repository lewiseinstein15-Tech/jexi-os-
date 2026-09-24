/**
 * JEXI OS — benchmarks/terminal-bench/actions.js
 *
 * Frozen v1 action space for the Terminal-Bench 2.1 adapter + validator.
 *
 *   exec   { command: string }        run a shell command
 *   wait   { ms?: number }            wait for output to settle
 *   ctrl   { key: 'c' | 'd' | 'z' }   send control key
 *   submit {}                        end the task and submit
 *
 * The space is FROZEN: unknown action names are E_UNKNOWN_ACTION; known
 * actions carrying missing/blank/extra arguments are E_INVALID_ARGUMENT.
 * Extra keys are rejected (frozen v1 means exactly these arguments).
 *
 * validate(proposed) NEVER throws — it returns
 *   { valid: true }
 * or
 *   { valid: false, errors: [Error{ code, field? }, ...] }
 * so callers (probe, runner) can inspect the verdict. agent.step() turns
 * the first error into a throw — the agent never emits an invalid action
 * to the runner side.
 *
 * Deterministic: pure functions over the proposal object, no wall-clock,
 * no randomness.
 */

export const ACTION_SPACE_VERSION = 'v1';

export const ACTION_SPACE = Object.freeze({
  exec: Object.freeze({
    description: 'run a shell command',
    args: Object.freeze({ command: 'required non-empty string' }),
  }),
  wait: Object.freeze({
    description: 'wait for output to settle',
    args: Object.freeze({ ms: 'optional non-negative finite number' }),
  }),
  ctrl: Object.freeze({
    description: 'send control key',
    args: Object.freeze({ key: "required, one of 'c' | 'd' | 'z'" }),
  }),
  submit: Object.freeze({
    description: 'end the task and submit',
    args: Object.freeze({}),
  }),
});

export const CTRL_KEYS = Object.freeze(['c', 'd', 'z']);

function unknownActionError(got) {
  const err = new Error(
    `E_UNKNOWN_ACTION — ${got} is not part of the frozen ${ACTION_SPACE_VERSION} action space ` +
    `(exec | wait | ctrl | submit)`
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
 * space. Returns { valid } or { valid: false, errors[] } — never throws.
 */
export function validate(proposed) {
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

  if (name === 'exec') {
    const cmd = args.command;
    if (typeof cmd !== 'string' || cmd.length === 0 || cmd.trim() === '') {
      errors.push(argError(name, 'command', 'command must be a non-empty string'));
    }
    for (const k of keys) {
      if (k !== 'command') {
        errors.push(argError(name, k, `unknown argument (frozen ${ACTION_SPACE_VERSION}: exec carries only command)`));
      }
    }
  } else if (name === 'wait') {
    if ('ms' in args) {
      const ms = args.ms;
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
        errors.push(argError(name, 'ms', 'ms must be a non-negative finite number'));
      }
    }
    for (const k of keys) {
      if (k !== 'ms') {
        errors.push(argError(name, k, `unknown argument (frozen ${ACTION_SPACE_VERSION}: wait carries only ms)`));
      }
    }
  } else if (name === 'ctrl') {
    const key = args.key;
    if (typeof key !== 'string' || !CTRL_KEYS.includes(key)) {
      errors.push(argError(name, 'key', `key must be one of ${CTRL_KEYS.map((k) => `'${k}'`).join(' | ')}`));
    }
    for (const k of keys) {
      if (k !== 'key') {
        errors.push(argError(name, k, `unknown argument (frozen ${ACTION_SPACE_VERSION}: ctrl carries only key)`));
      }
    }
  } else if (name === 'submit') {
    for (const k of keys) {
      errors.push(argError(name, k, 'submit takes no arguments'));
    }
  }

  return errors.length ? { valid: false, errors } : { valid: true };
}
