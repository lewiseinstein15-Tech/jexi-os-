// computer/operators/browser.js
// Phase 29 Scope C — browser operator (CDP seam + three declared modes).
//
// Backend seam (same discipline as Scope B desktop):
//   attachBackend(impl) injects the real CDP adapter (TARS drives Puppeteer
//   CDP; zero new dependencies here — the adapter is injected at
//   deployment). Backend contract (declared):
//     screenshot()                    -> { image, width, height, dpi }
//     click(pt) / doubleClick(pt) / rightClick(pt) -> result
//     drag(fromPt, toPt)              -> result
//     scroll(pt, direction)           -> result
//     type(text) / key(key)           -> result
//
// Phase 17 runtime seam (READ-ONLY consumption — no Phase 17 file is
// edited, no import at module load):
//   setDomRuntime(rt) injects an adapter over the Phase 17 DOM browser
//   runtime (server/src/services/BrowserRouter.js). Adapter contract
//   (declared, echoes the Phase 17 worker protocol):
//     name()                          -> string
//     execute(op, params)             -> { ok, ... }   op: 'click'|'doubleClick'|
//                                        'rightClick'|'drag'|'type'|'scroll'|'key'
//     confirmAt(pt)                   -> { found: true, tag?, text? } | { found: false }
//
// VLM seam (Scope E ships the real provider; any object with the shape
// below is accepted):
//     available()                     -> { available, model? }
//     infer({ image, instruction })   -> { raw, prediction }
//
// Mode dispatch for execute(action) — action coordinates are SCREEN-space
// (the loop normalizes before calling; Scope A coordinate.normalize):
//   dom:                domRuntime.execute(op, params)           (no VLM, no shot)
//   visual-grounding:   backend.screenshot() -> vlm.infer() ->
//                       action.parse(prediction) -> backend.<op>(grounded point)
//   hybrid:             backend.screenshot() -> vlm.infer() ->
//                       action.parse(prediction) ->
//                       domRuntime.confirmAt(pt) -- found --> domRuntime.execute(op, pt)
//                                               \- no match -> backend.<op>(pt)
//   keyboard actions (hotkey/type): dom -> domRuntime.execute; visual/hybrid ->
//                       backend.type / backend.key (no grounding needed)
//   wait / finished:    acknowledged loop-level, same as desktop (Scope F)
//
// Truthfulness: no backend -> screenshot() THROWS E_NO_BROWSER and
// execute() RETURNS { ok:false, error:{ code:'E_NO_BROWSER' } }. Success
// is never faked. Missing per-mode dependencies (vlm / domRuntime) surface
// E_VLM_UNAVAILABLE / E_DOM_RUNTIME_UNAVAILABLE respectively.

import { ComputerError } from '../errors.js';
import { assertOperator } from './interface.js';
import { DEFAULT_BROWSER_MODE, BROWSER_MODES, isBrowserMode } from './browser-modes.js';
import { action as actionFacade } from '../action/index.js';

// Frozen-v1 actions that carry a start_box (and optionally end_box) and
// therefore go through grounding in visual/hybrid modes.
const POINT_ACTIONS = Object.freeze(['click', 'left_double', 'right_single', 'scroll', 'drag']);
const KEYBOARD_ACTIONS = Object.freeze(['hotkey', 'type']);

const OP_TO_BACKEND = Object.freeze({
  click: 'click',
  left_double: 'doubleClick',
  right_single: 'rightClick',
  scroll: 'scroll',
  drag: 'drag',
  hotkey: 'key',
  type: 'type',
});

export function createBrowserOperator() {
  let backend = null;
  let domRuntime = null;
  let vlm = null;
  let mode = DEFAULT_BROWSER_MODE;

  function requireBackend() {
    if (!backend) {
      throw new ComputerError('E_NO_BROWSER', 'browser operator: no CDP backend in this environment', {});
    }
    return backend;
  }

  function requireVlm() {
    if (!vlm || typeof vlm.available !== 'function' || typeof vlm.infer !== 'function') {
      return { ok: false, error: { code: 'E_VLM_UNAVAILABLE', message: 'browser operator: no VLM provider injected' } };
    }
    const st = vlm.available();
    if (!st || st.available !== true) {
      return { ok: false, error: { code: 'E_VLM_UNAVAILABLE', message: 'browser operator: VLM provider reports unavailable', available: st ?? null } };
    }
    return { ok: true };
  }

  function requireDomRuntime() {
    if (!domRuntime || typeof domRuntime.execute !== 'function' || typeof domRuntime.confirmAt !== 'function') {
      return { ok: false, error: { code: 'E_DOM_RUNTIME_UNAVAILABLE', message: 'browser operator: no Phase 17 DOM runtime adapter injected' } };
    }
    return { ok: true };
  }

  /**
   * Grounding chain shared by visual-grounding and hybrid:
   * screenshot -> vlm.infer -> parse. Returns { ok:true, point, action,
   * prediction, shot } or { ok:false, error }.
   */
  function ground(action) {
    const shot = requireBackend().screenshot();
    const g = requireVlm();
    if (!g.ok) return g;
    let prediction;
    try {
      const res = vlm.infer({
        image: shot.image,
        instruction: `ground target for action ${action.action}`,
      });
      prediction = res.prediction;
    } catch (e) {
      return { ok: false, error: { code: e instanceof ComputerError ? e.code : 'E_VLM_UNAVAILABLE', message: `VLM infer failed: ${e?.message ?? e}` } };
    }
    try {
      const parsed = actionFacade.parse(prediction); // Scope A parser on the VLM prediction
      return { ok: true, parsed, shot };
    } catch (e) {
      return { ok: false, error: { code: 'E_MALFORMED_ACTION', message: `VLM prediction unparseable: ${e?.message ?? e}`, prediction } };
    }
  }

  const op = {
    name: 'browser',
    capabilities: Object.freeze({
      screenshot: true,
      mouse: true,
      keyboard: true,
      mobile: false,
      desktop: false,
      browser: true,
    }),

    /** Deployment-time seam: inject the real CDP adapter here. */
    attachBackend(impl) {
      if (!impl || typeof impl !== 'object') {
        throw new ComputerError('E_INVALID_ARGUMENT', 'attachBackend expects a backend object', { got: typeof impl });
      }
      backend = impl;
      return op;
    },

    /** Read-only consumption seam for the Phase 17 DOM runtime. */
    setDomRuntime(rt) {
      if (!rt || typeof rt !== 'object') {
        throw new ComputerError('E_INVALID_ARGUMENT', 'setDomRuntime expects an adapter object', { got: typeof rt });
      }
      domRuntime = rt;
      return op;
    },

    /** Scope E provider seam (stub in probes). */
    setVlm(provider) {
      if (!provider || typeof provider !== 'object') {
        throw new ComputerError('E_INVALID_ARGUMENT', 'setVlm expects a provider object', { got: typeof provider });
      }
      vlm = provider;
      return op;
    },

    hasBackend() {
      return backend !== null;
    },

    mode() {
      return mode;
    },

    setMode(next) {
      if (!isBrowserMode(next)) {
        throw new ComputerError('E_UNKNOWN_BROWSER_MODE', `unknown browser mode: ${next}`, {
          mode: next,
          known: Object.keys(BROWSER_MODES),
        });
      }
      mode = next;
      return mode;
    },

    screenshot() {
      return requireBackend().screenshot();
    },

    execute(action) {
      if (!action || typeof action !== 'object' || typeof action.action !== 'string') {
        throw new ComputerError('E_INVALID_ARGUMENT', 'execute expects a parsed action { action, args }', {
          got: action === null ? 'null' : typeof action,
        });
      }
      if (!backend) {
        return { ok: false, error: { code: 'E_NO_BROWSER', message: 'browser operator: no CDP backend in this environment' } };
      }
      const kind = action.action;

      // wait / finished: acknowledged loop-level (Scope F owns timing/stop).
      if (kind === 'wait') return { ok: true, result: { mode, waited: 'loop-level (Scope F); operator acknowledges' } };
      if (kind === 'finished') return { ok: true, result: { mode, finished: 'loop-level (Scope F); operator acknowledges' } };

      const backendOp = OP_TO_BACKEND[kind];

      // ---- dom mode: straight through the Phase 17 runtime ----------------
      if (mode === 'dom') {
        const d = requireDomRuntime();
        if (!d.ok) return d;
        const params = kind === 'type' ? { text: action.args.content }
          : kind === 'hotkey' ? { key: action.args.key }
          : kind === 'drag' ? { from: action.args.start_box, to: action.args.end_box }
          : kind === 'scroll' ? { point: action.args.start_box, direction: action.args.direction }
          : { point: action.args.start_box };
        const res = domRuntime.execute(backendOp, params);
        return { ok: true, result: { mode, executed: 'dom-runtime', op: backendOp, params, runtime: domRuntime.name?.() ?? 'unnamed', workerResult: res } };
      }

      // ---- keyboard actions under visual/hybrid: no grounding needed ------
      if (KEYBOARD_ACTIONS.includes(kind)) {
        if (kind === 'type') return { ok: true, result: { mode, executed: 'backend-type', backendResult: backend.type(action.args.content) } };
        return { ok: true, result: { mode, executed: 'backend-key', backendResult: backend.key(action.args.key) } };
      }

      // ---- point actions under visual/hybrid: grounding chain -------------
      if (!POINT_ACTIONS.includes(kind)) {
        return { ok: false, error: { code: 'E_INVALID_ARGUMENT', message: `unknown action for browser operator: ${kind}` } };
      }
      const g = ground(action);
      if (!g.ok) return g;
      const grounded = g.parsed; // parsed VLM prediction (Scope A parser)
      const pt = grounded.args.start_box;

      if (mode === 'visual-grounding') {
        const bOp = OP_TO_BACKEND[grounded.action] ?? 'click';
        const args = grounded.action === 'scroll' ? [pt, grounded.args.direction]
          : grounded.action === 'drag' ? [pt, grounded.args.end_box]
          : [pt];
        const res = backend[bOp](...args);
        return {
          ok: true,
          result: { mode, executed: 'coordinate', op: bOp, point: pt, prediction: grounded, backendResult: res },
        };
      }

      // ---- hybrid: DOM confirms at the VLM point, DOM executes, else CDP --
      const d = requireDomRuntime();
      if (!d.ok) return d;
      const hit = domRuntime.confirmAt(pt);
      if (hit && hit.found === true) {
        const params = grounded.action === 'scroll' ? { point: pt, direction: grounded.args.direction }
          : { point: pt };
        const res = domRuntime.execute(OP_TO_BACKEND[grounded.action] ?? 'click', params);
        return {
          ok: true,
          result: { mode, executed: 'dom-runtime', confirmed: hit, op: OP_TO_BACKEND[grounded.action] ?? 'click', point: pt, prediction: grounded, workerResult: res },
        };
      }
      const bOp = OP_TO_BACKEND[grounded.action] ?? 'click';
      const args = grounded.action === 'scroll' ? [pt, grounded.args.direction]
        : grounded.action === 'drag' ? [pt, grounded.args.end_box]
        : [pt];
      const res = backend[bOp](...args);
      return {
        ok: true,
        result: { mode, executed: 'coordinate-fallback', confirmed: hit ?? { found: false }, op: bOp, point: pt, prediction: grounded, backendResult: res },
      };
    },

    assert() {
      return assertOperator(op);
    },
  };
  return op;
}
