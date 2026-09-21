/**
 * JEXI OS — Phase 23 Scope C — ralph diagnostics: policy evaluator,
 * CI Doctor (untruncated failure logs) and mid-loop context injection.
 *
 *   import { diagnostics, ciDoctor, addContext } from '../harness/hardening/ralph/index.js';
 *
 *   diagnostics.evaluate({ task, verification, tests, skills, logs, deviations })
 *     -> { ok, findings: [{ code, severity, detail }] }
 *   ciDoctor.diagnose({ logs })
 *     -> { rootCause, evidence, suggestions[] }        // evidence verbatim, never truncated
 *   addContext.inject(loopId, { context }) -> { injectedAt }   // op-seq, no clocks
 *   addContext.get(loopId) -> [{ context, injectedAt }]
 *
 * `addContext` is a default shared instance; createAddContext() builds an
 * isolated one (its own op-seq counter starting at 1). Errors reuse
 * semantica/_internal.js SemanticaError (read-only). Policy violations are
 * findings, not throws; the direct throws are limited to caller mistakes
 * (E_INVALID_ARGUMENT) and diagnose-without-logs (E_NO_LOGS). No new error
 * class.
 */

import * as diagnostics from './diagnostics.js';
import * as ciDoctor from './ci-doctor.js';
import { addContext, createAddContext } from './add-context.js';

export {
  evaluate,
  LOGS_MIN_LINES,
  LOGS_MIN_CHARS,
  VERIFICATION_NONE,
} from './diagnostics.js';

export {
  diagnose,
  DIAGNOSTIC_PATTERNS,
} from './ci-doctor.js';

/** Grouped views matching the contract call style (addContext is the default shared instance). */
export { diagnostics, ciDoctor, addContext, createAddContext };
