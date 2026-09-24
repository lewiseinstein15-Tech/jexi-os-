/**
 * JEXI OS — Phase 26 Scope A — project scoping.
 *
 * Every instincts artifact lives under <root>/projects/<projectId>/.
 * Scoping is structural: the queue, the store, everything. An
 * observation recorded under project A physically cannot appear in
 * project B's directory, and readers assert the projectId on every
 * entry they return (defense in depth).
 */
import path from 'node:path';
import { fail } from '../../../services/semantica/_internal.js';

const PROJECT_RE = /^[a-z0-9][a-z0-9-]*$/;

export function assertProjectId(projectId) {
  if (typeof projectId !== 'string' || !PROJECT_RE.test(projectId)) {
    throw fail('E_BAD_PROJECT_ID', 'projectId must match ' + PROJECT_RE + ', got ' + JSON.stringify(projectId));
  }
  return projectId;
}

export function projectDir(root, projectId) {
  assertProjectId(projectId);
  return path.join(root, 'projects', projectId);
}

/** Throws E_SCOPE_MISMATCH unless the entry belongs to projectId. */
export function assertScope(entry, projectId) {
  if (!entry || entry.projectId !== projectId) {
    throw fail('E_SCOPE_MISMATCH', 'entry belongs to project ' + JSON.stringify(entry && entry.projectId) + ', not ' + JSON.stringify(projectId));
  }
  return entry;
}
