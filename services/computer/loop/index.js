// computer/loop/index.js
// Phase 29 Scope F — public surface of the GUI agent loop.
//
//   createGuiAgent({ vlm, operator, captureSource? })
//     -> { run, pause, resume, state }
//
//   run({ instruction, maxLoopCount = 25, onStep? })
//     -> { steps, stoppedBy }
//        steps:    completed step records
//                  [{ step, screenshot, prediction, action, result }]
//                  (a step that fails mid-sequence carries the stages that
//                  succeeded plus error: { code, message })
//        stoppedBy:'finished' | 'max-loops' | 'error'
//   pause()/resume() — pause blocks BEFORE the next capture; resume
//                      continues from the paused boundary, never re-running
//                      an interrupted step
//   state() -> { status: 'idle' | 'running' | 'paused' | 'done' }
//
// Per-step sequence: capture (Scope D) -> vlm.infer (Scope E) ->
// action.parse (Scope A) -> coordinate normalize (Scope A) ->
// operator.execute (Scope B/C). Operator errors are recorded and the loop
// continues; VLM/parse/capture errors stop the loop with the producing
// scope's declared code on the step record.
//
// Re-exports: createAgentState / AGENT_STATUSES (state machine),
// DEFAULT_MAX_LOOP_COUNT (25, TARS default), WAIT_PAUSE_MS (5000, wait
// semantics declared by Scope B). All errors are ComputerError; zero new
// dependencies; no path here fabricates a prediction, a screenshot, or
// success.

import { createGuiAgent, DEFAULT_MAX_LOOP_COUNT, WAIT_PAUSE_MS } from './gui-agent.js';
import { createAgentState, AGENT_STATUSES } from './state.js';

export { createGuiAgent, DEFAULT_MAX_LOOP_COUNT, WAIT_PAUSE_MS, createAgentState, AGENT_STATUSES };

export default { createGuiAgent, createAgentState, DEFAULT_MAX_LOOP_COUNT, WAIT_PAUSE_MS };
