/**
 * JEXI OS — KERNEL — learning seam (Phase 7 C).
 *
 * The kernel calls the continuous-learning subsystem at the SAME wiring
 * points that fire the Phase 7(B) hooks:
 *
 *   permission-gate.js  → observePreToolUse  (right after the PreToolUse hook)
 *   executor.js         → observePostToolUse (right after the PostToolUse hook)
 *   MissionRunner.js    → runStopAnalysis    (right after the Stop hook)
 *
 * The learning/ subsystem lives at the repo root (ECC reference layout, like
 * hooks/). It is imported DYNAMICALLY so a missing or broken learning/
 * directory can never take the brain down — the seam stays wired and
 * harmless, mirroring the hooks runner' fail-open philosophy. Callers get
 * synchronous no-ops in that case.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url)); // server/src/kernel/hooks
const LEARNING_URL = pathToFileURL(path.resolve(MODULE_DIR, '..', '..', '..', '..', 'learning', 'index.js')).href;

let _learning = null;
let _failed = false;

try {
  _learning = await import(LEARNING_URL);
} catch {
  _learning = null;
  _failed = true;
}

/** Repo root resolved from this module (server/src/kernel/hooks → repo root). */
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..', '..');

/** PreToolUse observation — journal one line for the call about to be gated. */
export function observePreToolUse(call, hookOut, ctx = {}) {
  try {
    if (!_learning) return null;
    return _learning.observePreToolUse(REPO_ROOT, call, hookOut, ctx);
  } catch {
    return null;
  }
}

/** PostToolUse observation — journal one line with the tool result + duration. */
export function observePostToolUse(call, result, ctx = {}) {
  try {
    if (!_learning) return null;
    return _learning.observePostToolUse(REPO_ROOT, call, result, ctx);
  } catch {
    return null;
  }
}

/** Stop — run the analyzer over this session's journal (once per session). */
export function runStopAnalysis(ctx = {}) {
  try {
    if (!_learning) return null;
    return _learning.runStopAnalysis({ ...ctx, repoRoot: REPO_ROOT });
  } catch {
    return null;
  }
}

/** Test/diagnostic hook — reports whether the learning subsystem loaded. */
export function learningSeamStatus() {
  return { loaded: Boolean(_learning), failed: _failed, repoRoot: REPO_ROOT };
}
