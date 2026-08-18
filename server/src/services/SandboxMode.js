/**
 * B134 — SANDBOX MODE (DeepSeek Harness `packages/sandbox/sandbox-policy`
 * mirror).
 *
 * A per-session sandbox mode folded from the conversation log (last
 * `sandbox/mode` event wins — replayable state, like DSH). Modes:
 *   read-only          — no writes/exec (fail-safe default)
 *   workspace-write    — writes inside the workspace, no external exec
 *   danger-full-access — everything (with the existing approval gates)
 *
 * The chat route consults the mode BEFORE tool dispatch; a denial returns
 * the DSH-style guidance so the model knows how to escalate.
 */

import { appendConversationEvent, loadConversationEvents } from './SessionConversations.js';

export const SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'];
export const DEFAULT_SANDBOX_MODE = 'workspace-write';

/** Fold the session's sandbox mode from the log (last one wins). */
export function effectiveSandboxMode(convId) {
  try {
    const events = loadConversationEvents(convId, 2000);
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.kind === 'sandbox/mode' && e.meta && SANDBOX_MODES.includes(e.meta.mode)) return e.meta.mode;
    }
  } catch { /* noop */ }
  return DEFAULT_SANDBOX_MODE;
}

/** Set the session's sandbox mode (log-backed). */
export function setSandboxMode(convId, mode) {
  if (!SANDBOX_MODES.includes(String(mode || ''))) return { ok: false, error: `mode must be one of ${SANDBOX_MODES.join(', ')}` };
  try {
    appendConversationEvent(convId, { role: 'system', kind: 'sandbox/mode', text: `sandbox mode → ${mode}`, meta: { mode } });
  } catch { /* noop */ }
  return { ok: true, mode };
}

/** Which tool kinds are blocked in a mode (DSH-style denial). */
export function sandboxDenial(mode, toolTier) {
  if (mode === 'danger-full-access') return null;
  if (mode === 'read-only') {
    if (toolTier !== 'read') {
      return { blocked: true, reason: 'Current sandbox mode is read-only: no writes, no execution. Request the user to switch to workspace-write (or danger-full-access) before mutating tools.' };
    }
    return null;
  }
  // workspace-write: writes ok inside the workspace; execution still gated.
  if (toolTier === 'exec' || toolTier === 'external' || toolTier === 'risky') {
    return { blocked: true, reason: 'Current sandbox mode is workspace-write: files may change inside the workspace, but execution/external actions require danger-full-access. Request it with justification.' };
  }
  return null;
}
