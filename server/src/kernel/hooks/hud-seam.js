/**
 * JEXI OS — KERNEL — hud seam (Phase 7 F).
 *
 * The kernel feeds the HUD status contract at the SAME wiring points that
 * fire the Phase 7(B) hooks and the Phase 7(C) observer:
 *
 *   permission-gate.js  → hudObservePreToolUse   (call entered the gate)
 *   executor.js         → hudObservePostToolUse  (call resolved ok/fail)
 *   LLMClient.js        → hudNoteSpend           (real model-call sizes)
 *   index.js self-ping  → hudNoteCheck('remote') (Render keep-warm probe)
 *
 * The HUD subsystem lives at the repo root (events/hud/, ECC reference
 * layout). It is imported DYNAMICALLY so a missing or broken events/hud/
 * can never take the brain down — the seam stays wired and harmless,
 * mirroring the hooks runner' fail-open philosophy.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url)); // server/src/kernel/hooks
const HUD_URL = pathToFileURL(path.resolve(MODULE_DIR, '..', '..', '..', '..', 'events', 'hud', 'index.js')).href;

let _hud = null;
let _failed = false;

try {
  _hud = await import(HUD_URL);
} catch {
  _hud = null;
  _failed = true;
}

/** PreToolUse — HUD marks the call as pending (stale tracking starts). */
export function hudObservePreToolUse(call, ctx = {}) {
  try {
    if (!_hud) return null;
    return _hud.noteToolPending(call, ctx);
  } catch { return null; }
}

/** PostToolUse — HUD records the resolved call (recent ring + risk streak). */
export function hudObservePostToolUse(call, result, ctx = {}) {
  try {
    if (!_hud) return null;
    return _hud.recordToolCall(call, result, ctx);
  } catch { return null; }
}

/**
 * Model-call spend — real prompt/completion sizes from the provider walk.
 * Tokens are estimated at chars/4 (the project convention) and priced via
 * the producer's indicative table; ok=false records a model failure signal.
 */
export function hudNoteSpend(provider, model, sizes = {}, ok = true) {
  try {
    if (!_hud) return null;
    return _hud.noteSpend({ provider, model, ...sizes, ok });
  } catch { return null; }
}

/** Check note — kind 'local' (verification) or 'remote' (self-ping probe). */
export function hudNoteCheck(kind, status) {
  try {
    if (!_hud) return null;
    return _hud.noteCheck(kind, status);
  } catch { return null; }
}

/** Test/diagnostic hook — reports whether the HUD subsystem loaded. */
export function hudSeamStatus() {
  return { loaded: Boolean(_hud), failed: _failed };
}
