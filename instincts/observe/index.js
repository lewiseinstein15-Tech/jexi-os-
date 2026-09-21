/**
 * JEXI OS — Phase 26 Scope A — observe entry point.
 *
 *   const observe = createObserve(instinctsDir)
 *   observe.attach(sessionId, { projectId })  -> { observerId }
 *   observe.detach(observerId)                -> { detached }
 *   observe.push(observation)                 -> { observationId }
 *   observe.drain(projectId)                  -> [observations]
 *   observe.scope(projectId)                  -> { isolated }
 *
 * DOCUMENTED SCOPE SEMANTICS:
 *   drain(projectId) returns ONLY that project's observations (empty
 *   array when none) and scope-checks every stored entry; it NEVER
 *   returns another project's data. E_SCOPE_MISMATCH is raised when a
 *   stored entry disagrees with its project directory (tampering) or
 *   when a session is attached under two projects.
 * push() requires an ACTIVE observer for the observation's session.
 * Reuses SemanticaError/fail from Phase 14 (read-only import).
 */
import fs from 'node:fs';
import { fail } from '../../semantica/_internal.js';
import { attachObserver, detachObserver, requireActiveObserver } from './hook.js';
import { pushObservation, drainObservations, currentOp } from './queue.js';
import { assertProjectId, projectDir } from './scope.js';

export function createObserve(instinctsDir) {
  if (typeof instinctsDir !== 'string' || instinctsDir.trim() === '') {
    throw fail('E_INVALID_ARGUMENT', 'instinctsDir must be a non-empty string');
  }
  fs.mkdirSync(instinctsDir, { recursive: true });
  return {
    path: instinctsDir,
    attach: (sessionId, opts) => attachObserver(instinctsDir, sessionId, opts),
    detach: (observerId) => detachObserver(instinctsDir, observerId),
    push(observation) {
      if (!observation || typeof observation !== 'object') {
        throw fail('E_INVALID_OBSERVATION', 'observation must be an object { projectId, sessionId, kind, payload? }');
      }
      const projectId = assertProjectId(observation.projectId);
      const ob = requireActiveObserver(instinctsDir, observation.sessionId);
      if (ob.projectId !== projectId) {
        throw fail('E_SCOPE_MISMATCH', 'observation targets project ' + JSON.stringify(projectId) + ' but the session observer belongs to ' + JSON.stringify(ob.projectId));
      }
      const entry = pushObservation(instinctsDir, observation);
      return { observationId: entry.id };
    },
    drain(projectId) {
      assertProjectId(projectId);
      // Diagnostic only (Phase 26 A-fix): missing observations dir is legal
      // (drain returns []), but it is reported on stderr for observability.
      if (!fs.existsSync(projectDir(instinctsDir, projectId))) {
        console.error('[jexi:observe] drain called for project with no observations dir: ' + projectId);
      }
      return drainObservations(instinctsDir, projectId);
    },
    scope(projectId) {
      assertProjectId(projectId);
      // isolated: the project's queue exists in its own directory and every
      // stored entry carries this projectId (verified, not assumed).
      let isolated = true;
      try {
        for (const entry of drainObservations(instinctsDir, projectId)) {
          if (entry.projectId !== projectId) { isolated = false; break; }
        }
      } catch { isolated = false; }
      return { isolated, dir: projectDir(instinctsDir, projectId) };
    },
    currentOp: () => currentOp(instinctsDir),
  };
}

export { attachObserver, detachObserver, requireActiveObserver } from './hook.js';
export { pushObservation, drainObservations, nextOp, currentOp } from './queue.js';
export { assertProjectId, projectDir, assertScope } from './scope.js';
export { SemanticaError } from '../../semantica/_internal.js';
