/**
 * JEXI OS — Phase 26 Scope A — session event observer (hook).
 *
 * Observers are persisted at <root>/observers.json (map keyed by
 * observerId, written in sorted-key order for determinism).
 *   observerId = 'observer-' + slug(sessionId)  -> attach is
 *   idempotent: the same sessionId always yields the same observerId.
 * Attaching the same session under a DIFFERENT project is a scope
 * violation -> E_SCOPE_MISMATCH. detach() deactivates the observer;
 * queued observations remain (append-only).
 *   push through an unknown/detached observer -> E_OBSERVER_DETACHED
 */
import fs from 'node:fs';
import path from 'node:path';
import { fail, assertNonEmptyString } from '../../../services/semantica/_internal.js';
import { assertProjectId } from './scope.js';

const observersFile = (root) => path.join(root, 'observers.json');

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function readObservers(root) {
  try { return JSON.parse(fs.readFileSync(observersFile(root), 'utf8')); }
  catch { return {}; }
}

function writeObservers(root, map) {
  const sorted = {};
  for (const k of Object.keys(map).sort()) sorted[k] = map[k];
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(observersFile(root), JSON.stringify(sorted, null, 2) + '\n');
}

export function attachObserver(root, sessionId, opts = {}) {
  assertNonEmptyString(sessionId, 'sessionId', 'E_INVALID_OBSERVER');
  const projectId = assertProjectId(opts.projectId);
  const observerId = 'observer-' + slug(sessionId);
  const map = readObservers(root);
  const existing = map[observerId];
  if (existing) {
    if (existing.projectId !== projectId) {
      throw fail('E_SCOPE_MISMATCH', 'session ' + JSON.stringify(sessionId) + ' is already attached under project ' + JSON.stringify(existing.projectId));
    }
    if (!existing.active) existing.active = true; // re-attach after detach
    writeObservers(root, map);
    return { observerId };
  }
  map[observerId] = { observerId, sessionId, projectId, active: true };
  writeObservers(root, map);
  return { observerId };
}

export function detachObserver(root, observerId) {
  const map = readObservers(root);
  const ob = map[observerId];
  if (!ob) throw fail('E_UNKNOWN_OBSERVER', 'unknown observerId: ' + JSON.stringify(observerId));
  ob.active = false;
  writeObservers(root, map);
  return { detached: true };
}

/** Resolves the ACTIVE observer for a session; else E_OBSERVER_DETACHED. */
export function requireActiveObserver(root, sessionId) {
  const map = readObservers(root);
  const ob = map['observer-' + slug(sessionId)];
  if (!ob) {
    throw fail('E_OBSERVER_DETACHED', 'no observer attached for session ' + JSON.stringify(sessionId));
  }
  if (!ob.active) {
    throw fail('E_OBSERVER_DETACHED', 'observer for session ' + JSON.stringify(sessionId) + ' is detached');
  }
  return ob;
}

export { readObservers };
