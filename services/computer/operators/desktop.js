// computer/operators/desktop.js
// Phase 29 Scope B — desktop operator (SEAM, same discipline as the Phase 28
// embedding provider).
//
// The real backend is nut-js (@computer-use/nut-js, TARS NutJSOperator):
// it requires a display server (X11/Wayland on Linux, native GUI on
// macOS/Windows) plus OS accessibility permissions. Neither exists in the
// sandbox. This module is therefore structured as:
//
//   1. Display detection (declared, environment-derived, call-time):
//        hasDisplay = darwin|win32  ->  true
//                     otherwise     ->  Boolean(DISPLAY || WAYLAND_DISPLAY)
//   2. Backend attachment: attachBackend(impl) injects the real nut-js
//      adapter at deployment time. NO package is added here (zero new
//      dependencies); the sandbox runs with no backend attached.
//   3. Dispatch: with display + backend, execute(action) routes the frozen
//      v1 action vocabulary to backend handlers.
//
// Truthfulness rules enforced here:
// - capabilities describe the BACKEND's design (screenshot/mouse/keyboard/
//   desktop: true, mobile: false) — they do not depend on display state.
// - Without a display, screenshot() THROWS E_NO_DISPLAY and execute()
//   RETURNS { ok: false, error: { code: 'E_NO_DISPLAY' } }. Success is
//   never faked.
// - With a display but no attached backend: E_DESKTOP_BACKEND_UNAVAILABLE.

import { ComputerError } from '../errors.js';
import { assertOperator } from './interface.js';

export function hasDisplay(env = process.env, platform = process.platform) {
  if (platform === 'darwin' || platform === 'win32') return true;
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

// Dispatch table over the frozen v1 vocabulary. wait/finished are
// acknowledged without backend I/O (their loop-level semantics — 5s pause +
// screenshot / loop termination — belong to Scope F, not the pointer).
const HANDLERS = Object.freeze({
  click:        (b, a) => b.click(a.args.start_box),
  left_double:  (b, a) => b.doubleClick(a.args.start_box),
  right_single: (b, a) => b.rightClick(a.args.start_box),
  drag:         (b, a) => b.drag(a.args.start_box, a.args.end_box),
  hotkey:       (b, a) => b.hotkey(a.args.key),
  type:         (b, a) => b.type(a.args.content),
  scroll:       (b, a) => b.scroll(a.args.start_box, a.args.direction),
  wait:         () => ({ waited: 'loop-level (Scope F); operator acknowledges' }),
  finished:     () => ({ finished: 'loop-level (Scope F); operator acknowledges' }),
});

export function createDesktopOperator() {
  let backend = null;

  const op = {
    name: 'desktop',
    capabilities: Object.freeze({
      screenshot: true,
      mouse: true,
      keyboard: true,
      mobile: false,
      desktop: true,
    }),

    /** Deployment-time seam: inject the real nut-js adapter here. */
    attachBackend(impl) {
      if (!impl || typeof impl !== 'object') {
        throw new ComputerError('E_INVALID_ARGUMENT', 'attachBackend expects a backend object', {
          got: typeof impl,
        });
      }
      backend = impl;
      return op;
    },

    hasBackend() {
      return backend !== null;
    },

    screenshot() {
      if (!hasDisplay()) {
        throw new ComputerError('E_NO_DISPLAY', 'desktop operator: no display server in this environment', {
          display: { DISPLAY: process.env.DISPLAY ?? null, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY ?? null },
        });
      }
      if (!backend) {
        throw new ComputerError('E_DESKTOP_BACKEND_UNAVAILABLE', 'desktop operator: no backend attached', {});
      }
      return backend.screenshot();
    },

    execute(action) {
      if (!action || typeof action !== 'object' || typeof action.action !== 'string') {
        throw new ComputerError('E_INVALID_ARGUMENT', 'execute expects a parsed action { action, args }', {
          got: action === null ? 'null' : typeof action,
        });
      }
      if (!hasDisplay()) {
        return {
          ok: false,
          error: {
            code: 'E_NO_DISPLAY',
            message: 'desktop operator: no display server in this environment',
            display: {
              DISPLAY: process.env.DISPLAY ?? null,
              WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY ?? null,
            },
          },
        };
      }
      if (!backend) {
        return {
          ok: false,
          error: {
            code: 'E_DESKTOP_BACKEND_UNAVAILABLE',
            message: 'desktop operator: display present but no backend attached',
          },
        };
      }
      const handler = HANDLERS[action.action];
      if (!handler) {
        return {
          ok: false,
          error: { code: 'E_INVALID_ARGUMENT', message: `unknown action: ${action.action}` },
        };
      }
      return { ok: true, result: handler(backend, action) };
    },

    assert() {
      return assertOperator(op);
    },
  };
  return op;
}
