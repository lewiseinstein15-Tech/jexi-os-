// computer/loop/gui-agent.js
// Phase 29 Scope F — the GUI agent loop (TARS GUIAgent port).
//
// TARS GUIAgent discipline: screenshot -> VLM -> parse -> execute -> repeat,
// with pause/resume, a loop budget, and per-step event callbacks.
//
// Per-step sequence (declared):
//   capture (Scope D) -> vlm.infer (Scope E) -> action.parse (Scope A)
//     -> coordinate normalize (Scope A) -> operator.execute (Scope B/C)
//
// Contract:
//   createGuiAgent({ vlm, operator, captureSource? })
//     vlm     — Scope C/E seam: available() + infer({ image, instruction })
//               -> { raw, prediction } | Promise<{ raw, prediction }>
//     operator— Scope B/C operator (assertOperator-checked at construction)
//     captureSource — optional Scope D source ({ grab() | screenshot() ->
//               PNG bytes }). Default: a DECLARED adapter over the operator
//               (see operatorCaptureSource below).
//   run({ instruction, maxLoopCount = 25, onStep? })
//     -> { steps, stoppedBy }
//        steps:    [{ step, screenshot, prediction, action, result }] for
//                  completed steps; a step that failed mid-sequence carries
//                  the stages that DID succeed plus error: { code, message }:
//                    capture fail -> { step, error }
//                    infer fail   -> { step, screenshot, error }
//                    parse fail   -> { step, screenshot, prediction, error }
//        stoppedBy:'finished' | 'max-loops' | 'error'
//   pause()   — blocks the loop BEFORE the next capture (at the next loop-top)
//   resume()  — continues from the paused boundary; the interrupted step is
//               never re-run (it had already completed and been recorded)
//   state()   -> { status: 'idle' | 'running' | 'paused' | 'done' }
//
// Declared loop semantics:
// - maxLoopCount default 25 (TARS default). The budget is a hard resource
//   bound checked at loop-top BEFORE the pause gate: once exhausted there is
//   no next capture to block, so the run ends 'max-loops' even if a pause
//   request is pending.
// - `finished` is executed through the operator like any action (uniform
//   sequence, result recorded), THEN ends the loop with stoppedBy='finished'.
// - `wait` semantics (declared by Scope B desktop.js: "5s pause + screenshot
//   ... belong to Scope F"): after a completed wait step the loop sleeps
//   WAIT_PAUSE_MS before the next capture (the next iteration's capture IS
//   the fresh screenshot). Records are unaffected; the constant is declared.
// - Operator errors NEVER crash the loop: a returned { ok:false, error } is
//   recorded on the step and the loop continues; a thrown ComputerError is
//   recorded the same way and the loop continues. A thrown foreign
//   (non-ComputerError) or a non-{ok} return is recorded as
//   E_OPERATOR_INCOMPLETE (Scope B contract violation) and the loop continues.
// - VLM errors STOP the loop (stoppedBy='error', code on the step): the VLM
//   is required for the loop to reason. Parse failures stop the loop for the
//   same reason — an unparseable prediction is a broken reasoning stream
//   (mirrors Scope C browser.js ground()). Capture failures stop the loop:
//   without a screenshot there is nothing to reason about (the operator's
//   own declared code — e.g. E_NO_DISPLAY / E_NO_BROWSER — propagates
//   UNCHANGED through Scope D capture).
// - The loop sends the capture bytes to the VLM UNMODIFIED (no optimize
//   stage in the declared sequence), so the model space equals the capture
//   space; the coordinate normalize call at the operator boundary is the
//   real Scope A formula (Scope C contract: execute() receives SCREEN-space
//   points) — identity for in-range points, clamping for out-of-range ones.
//   The step record carries the NORMALIZED (executed) args; the prediction
//   string keeps the model-space original.
// - The same instruction is sent to the VLM on every step (TARS discipline:
//   goal instruction per turn; conversational context comes from the VLM's
//   own internal history — Scope E sliding window).
// - Records are structured and NEVER swallowed or skipped: every step
//   produces exactly one record, error records included, each pushed and
//   then announced via the onStep callback (fired synchronously after the
//   push; a throwing onStep is observer misuse -> run() rejects with
//   E_INVALID_ARGUMENT; the record stays in steps).
// - Determinism: no clock, no randomness in the record path. Given the same
//   operator + VLM + capture, two fresh agents produce byte-identical step
//   records. (The wait sleep and pause gates affect timing only.)
// - Truthfulness: nothing here fabricates predictions, screenshots, or
//   success. Every failure surfaces as a declared ComputerError code owned
//   by the scope that produced it; foreign errors from injected seams are
//   recorded under that stage's declared wrapping code, never propagated as
//   a foreign error class, never swallowed.

import { ComputerError } from '../errors.js';
import { assertOperator } from '../operators/interface.js';
import { capture } from '../screenshot/index.js';
import { parse } from '../action/parser.js';
import { normalize } from '../action/coordinate.js';
import { actionSchema } from '../action/space.js';
import { createAgentState } from './state.js';

export const DEFAULT_MAX_LOOP_COUNT = 25; // TARS maxLoopCount default (declared)
export const WAIT_PAUSE_MS = 5000; // wait action: pause before next capture (Scope B declaration)

function invalidArgument(message, details) {
  return new ComputerError('E_INVALID_ARGUMENT', message, details ?? {});
}

function isBytes(v) {
  return Buffer.isBuffer(v) || v instanceof Uint8Array;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Declared bridge: Scope B/C operators expose screenshot() -> { image,
 * width, height, dpi } (backend contract), while Scope D capture() consumes
 * a source whose screenshot() returns PNG bytes. The adapter forwards bytes
 * verbatim when the operator returns bytes directly, and unwraps the
 * `image` field only when it is actual bytes. Anything else passes through
 * and is refused truthfully by capture() (E_NO_CAPTURE_SOURCE /
 * E_INVALID_IMAGE). A ComputerError thrown by the operator (E_NO_DISPLAY /
 * E_NO_BROWSER) propagates UNCHANGED through capture() — this is how the
 * loop surfaces "no operator backend" in the sandbox.
 */
function operatorCaptureSource(op) {
  return {
    name: `operator:${op.name}`,
    screenshot() {
      const s = op.screenshot();
      if (isBytes(s)) return s;
      if (s && typeof s === 'object' && isBytes(s.image)) return s.image;
      return s;
    },
  };
}

/**
 * Step-error record. The scope modules (capture/parse/vlm) only emit
 * ComputerError, whose declared code is recorded verbatim. A FOREIGN error
 * escaping an injected seam is recorded under that stage's declared
 * wrapping code (mirroring Scope E's transportError discipline) — a foreign
 * error class never crosses the computer/** boundary, and nothing is
 * swallowed.
 */
function recordError(err, wrapCode, wrapLabel) {
  if (err instanceof ComputerError) return { code: err.code, message: err.message };
  return {
    code: wrapCode,
    message: `${wrapLabel}: non-ComputerError from an injected seam (${err && err.message ? err.message : String(err)})`,
  };
}

export function createGuiAgent(opts = {}) {
  if (!opts || typeof opts !== 'object' || Array.isArray(opts)) {
    throw invalidArgument('createGuiAgent: options must be an object', { got: typeof opts });
  }
  const { vlm, operator, captureSource = null } = opts;

  // Construction-time contract checks (misuse -> fail fast).
  if (!vlm || typeof vlm !== 'object' || typeof vlm.available !== 'function' || typeof vlm.infer !== 'function') {
    throw invalidArgument('createGuiAgent: vlm must be an object exposing available() and infer() (Scope C/E seam)', {
      got: vlm === null ? 'null' : typeof vlm,
    });
  }
  assertOperator(operator); // throws E_OPERATOR_INCOMPLETE (Scope B declared code)
  if (captureSource !== null) {
    if (
      !captureSource ||
      typeof captureSource !== 'object' ||
      (typeof captureSource.grab !== 'function' && typeof captureSource.screenshot !== 'function')
    ) {
      throw invalidArgument('createGuiAgent: captureSource must implement grab() or screenshot() (Scope D source shape)', {
        got: Object.keys(captureSource ?? {}).join(','),
      });
    }
  }

  const state = createAgentState();
  const source = captureSource ?? operatorCaptureSource(operator);

  async function run(args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw invalidArgument('run: args must be an object', { got: typeof args });
    }
    const { instruction, maxLoopCount = DEFAULT_MAX_LOOP_COUNT, onStep = null } = args;
    if (typeof instruction !== 'string' || instruction.length === 0) {
      throw invalidArgument('run: instruction must be a non-empty string', { got: typeof instruction });
    }
    if (!Number.isInteger(maxLoopCount) || maxLoopCount <= 0) {
      throw invalidArgument(`run: maxLoopCount must be a positive integer (default ${DEFAULT_MAX_LOOP_COUNT})`, {
        got: maxLoopCount,
      });
    }
    if (onStep !== null && typeof onStep !== 'function') {
      throw invalidArgument('run: onStep must be a function when provided', { got: typeof onStep });
    }

    state.begin(); // E_INVALID_ARGUMENT if a run is already active/paused

    const steps = [];
    let stoppedBy = null;

    try {
      while (true) {
        // loop-top 1 (declared order): the budget is a hard resource bound,
        // checked before the pause gate — an exhausted budget ends the run
        // even if a pause request is pending (no next capture exists).
        if (steps.length >= maxLoopCount) {
          stoppedBy = 'max-loops';
          break;
        }
        // loop-top 2: pause gate — blocks BEFORE the next capture. Steps
        // already completed stay recorded; after resume the loop starts a
        // FRESH step (the interrupted step is never re-run).
        if (state.pauseRequested()) {
          await state.arrivePaused();
        }

        const stepNo = steps.length + 1;

        // -- stage 1: capture (Scope D) ----------------------------------
        let shot;
        try {
          shot = capture(source);
        } catch (err) {
          steps.push({ step: stepNo, error: recordError(err, 'E_NO_CAPTURE_SOURCE', 'capture stage') });
          stoppedBy = 'error';
          break;
        }

        // -- stage 2: infer (Scope E; sync result or Promise, dual mode) --
        let prediction;
        try {
          const r = vlm.infer({ image: shot.image, instruction });
          prediction = r && typeof r.then === 'function' ? await r : r.prediction;
          if (typeof prediction !== 'string' || prediction.length === 0) {
            throw new ComputerError('E_VLM_MALFORMED', 'vlm seam returned a non-string prediction', {
              got: prediction === null ? 'null' : typeof prediction,
            });
          }
        } catch (err) {
          steps.push({ step: stepNo, screenshot: shot, error: recordError(err, 'E_VLM_ERROR', 'infer stage') });
          stoppedBy = 'error';
          break;
        }

        // -- stage 3: parse (Scope A) --------------------------------------
        // An unparseable prediction is a broken reasoning stream (VLM-grade
        // failure) — the loop stops; it does not guess or retry blindly.
        let act;
        try {
          act = parse(prediction);
        } catch (err) {
          steps.push({
            step: stepNo,
            screenshot: shot,
            prediction,
            error: recordError(err, 'E_MALFORMED_ACTION', 'parse stage'),
          });
          stoppedBy = 'error';
          break;
        }

        // -- stage 4: normalize model-space points -> screen space (Scope A)
        // The VLM saw the capture bytes unmodified, so model space ==
        // capture space (declared; see module header). Real Scope A formula
        // at the operator boundary per the Scope C contract.
        const modelSize = { width: shot.width, height: shot.height };
        const screenSize = { width: shot.width, height: shot.height };
        const schema = actionSchema(act.action);
        const argsNorm = { ...act.args };
        for (const [key, spec] of Object.entries(schema.args)) {
          if (spec.kind === 'box') {
            argsNorm[key] = normalize(argsNorm[key], { modelSize, screenSize });
          }
        }

        // -- stage 5: execute (Scope B/C) — operator errors NEVER crash ----
        let result;
        try {
          const r = operator.execute({ action: act.action, args: argsNorm });
          result =
            r && typeof r === 'object' && typeof r.ok === 'boolean'
              ? r
              : {
                  ok: false,
                  error: {
                    code: 'E_OPERATOR_INCOMPLETE',
                    message: 'operator.execute returned a non-{ok} result (Scope B contract violation)',
                  },
                };
        } catch (err) {
          result =
            err instanceof ComputerError
              ? { ok: false, error: { code: err.code, message: err.message } }
              : {
                  ok: false,
                  error: {
                    code: 'E_OPERATOR_INCOMPLETE',
                    message: `operator.execute threw a non-ComputerError (Scope B contract violation): ${
                      err && err.message ? err.message : String(err)
                    }`,
                  },
                };
        }

        const rec = {
          step: stepNo,
          screenshot: shot,
          prediction,
          action: { action: act.action, args: argsNorm, raw: act.raw },
          result,
        };
        steps.push(rec);
        if (onStep !== null) {
          try {
            onStep(rec);
          } catch (e) {
            // Observer misuse fails fast; the record stays in steps.
            throw invalidArgument(`onStep callback threw: ${e && e.message ? e.message : String(e)}`, {});
          }
        }

        if (act.action === 'finished') {
          stoppedBy = 'finished';
          break;
        }
        if (act.action === 'wait') {
          // Declared wait semantics (Scope B): pause, then the next capture.
          await sleep(WAIT_PAUSE_MS);
        }
      }
    } finally {
      state.markDone(); // every exit path lands in 'done' — state never lies
    }

    return { steps, stoppedBy };
  }

  return {
    run,
    /** Pause: blocks the loop at the next loop-top, before the next capture. */
    pause() {
      return state.requestPause();
    },
    /** Resume: continues cleanly from the paused boundary (no step re-run). */
    resume() {
      return state.resume();
    },
    /** Session status: { status: 'idle' | 'running' | 'paused' | 'done' }. */
    state() {
      return { status: state.status() };
    },
  };
}
