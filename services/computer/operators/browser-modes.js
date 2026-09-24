// computer/operators/browser-modes.js
// Phase 29 Scope C — the three browser strategies, DECLARED (TARS
// BrowserOperator modes).
//
//   dom                fast path on structured pages; actions execute
//                      through the Phase 17 DOM runtime (BrowserRouter,
//                      read-only consumption via injected adapter).
//   visual-grounding   screenshot -> VLM -> coordinate action; works on
//                      Canvas / non-standard UI where there is no DOM.
//   hybrid             VLM proposes coordinates, DOM confirms an element
//                      exists at that point (elementFromPoint-equivalent
//                      through the Phase 17 runtime), DOM executes; if DOM
//                      has no match there, falls back to a coordinate
//                      execution through the CDP backend.
//
// DEFAULT = 'hybrid'. The mode set is closed: unknown -> E_UNKNOWN_BROWSER_MODE.
// Only point-carrying actions (click / left_double / right_single / scroll /
// drag) go through grounding; keyboard actions (hotkey / type) execute
// directly; wait / finished are acknowledged loop-level (Scope F).

export const DEFAULT_BROWSER_MODE = 'hybrid';

export const BROWSER_MODES = Object.freeze({
  dom: Object.freeze({
    id: 'dom',
    description: 'fast path on structured pages: executes through the Phase 17 DOM runtime',
    requires: Object.freeze(['domRuntime']),
  }),
  'visual-grounding': Object.freeze({
    id: 'visual-grounding',
    description: 'screenshot -> VLM -> coordinate action (Canvas / non-standard UI)',
    requires: Object.freeze(['vlm']),
  }),
  hybrid: Object.freeze({
    id: 'hybrid',
    description: 'VLM proposes coordinates, DOM confirms, DOM executes; coordinate fallback when DOM has no match',
    requires: Object.freeze(['vlm', 'domRuntime']),
  }),
});

export function isBrowserMode(id) {
  return Object.prototype.hasOwnProperty.call(BROWSER_MODES, id);
}

export function browserModeIds() {
  return Object.keys(BROWSER_MODES);
}

// Error codes declared by Scope C. Every one is carried by ComputerError
// (computer/errors.js) — no new error class.
export const BROWSER_CODES = Object.freeze([
  'E_UNKNOWN_BROWSER_MODE',      // setMode with a mode outside the closed set
  'E_NO_BROWSER',                // no CDP backend attached in this environment
  'E_VLM_UNAVAILABLE',           // grounding mode without an available VLM
  'E_DOM_RUNTIME_UNAVAILABLE',   // mode requires the Phase 17 runtime adapter
]);
