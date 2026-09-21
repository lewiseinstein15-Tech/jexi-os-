/**
 * JEXI OS — Phase 26 Scope C — queries by project, confidence, action.
 *
 * list(root, projectId, { minConfidence?, action? }) -> instinct[]
 * Ordering is DECLARED and deterministic: confidence DESC, id ASC.
 * Every record read from a project directory is scope-checked; a
 * record whose projectId disagrees with its directory is a tampering
 * signal -> E_SCOPE_MISMATCH.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../../semantica/_internal.js';
import { projectDir, assertProjectId } from '../observe/scope.js';

const instinctsDir = (root, projectId) => path.join(projectDir(root, projectId), 'instincts');

export function readAll(root, projectId) {
  assertProjectId(projectId);
  const dir = instinctsDir(root, projectId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (rec.projectId !== projectId) {
        throw fail('E_SCOPE_MISMATCH', 'record ' + rec.id + ' in project ' + projectId + ' carries projectId ' + JSON.stringify(rec.projectId));
      }
      return rec;
    });
}

export function list(root, projectId, { minConfidence, action } = {}) {
  if (minConfidence !== undefined && (typeof minConfidence !== 'number' || minConfidence < 0 || minConfidence > 1)) {
    throw fail('E_INVALID_FILTER', 'minConfidence must be a number in [0, 1]');
  }
  if (action !== undefined && (typeof action !== 'string' || action.trim() === '')) {
    throw fail('E_INVALID_FILTER', 'action filter must be a non-empty string');
  }
  return readAll(root, projectId)
    .filter((rec) => (minConfidence === undefined || rec.confidence >= minConfidence))
    .filter((rec) => (action === undefined || rec.action === action))
    .sort((a, b) => (b.confidence !== a.confidence ? b.confidence - a.confidence : (a.id < b.id ? -1 : 1)));
}
