/**
 * JEXI OS — PHASE 31 SCOPE 3 — W23f: ciDoctor -> CI failure path (PARTIAL).
 *
 * CONNECT, do not rebuild: harness/hardening/ralph/ci-doctor.js is READ-ONLY.
 * This module is the single wiring seam a CI failure path calls — one
 * function, verbatim passthrough of the shipped diagnosis. No adapter
 * reshapes the diagnosis record ({ rootCause, evidence, suggestions }).
 *
 * Wired here: the handler a CI failure path can invoke with the raw failing
 * log. NOT wired in this scope (disclosed): the .github/workflows call-site
 * edit — it is outside this scope's named call-site list, and CI green is
 * not verifiable from the sandbox. The live-CI leg stays NOT VERIFIED per
 * the plan's PARTIAL verdict; E_NO_LOGS (refuses to guess) is the honest
 * failure path when no log is provided.
 */

import { ciDoctor, DIAGNOSTIC_PATTERNS } from '../../../harness/hardening/ralph/index.js';

export function initCiDoctor() {
  /** Verbatim passthrough — the one call a CI failure path needs. */
  function diagnose({ logs } = {}) {
    return ciDoctor.diagnose({ logs });
  }

  return {
    diagnose,
    patternCount: DIAGNOSTIC_PATTERNS.length,
    knownSignatures: DIAGNOSTIC_PATTERNS.map((p) => p.rootCause),
    liveCIVerified: false, // standing honesty flag: sandbox has no CI runner
  };
}

export default initCiDoctor;
