/**
 * B137 — USER APPROVAL (DeepSeek Harness `packages/interaction/user-approval`
 * mirror, JEXI-branded).
 *
 * Per-session approval policy, log-backed (last `approval/policy` event wins):
 *   'ask'   — (default) external/irreversible actions pause for ONE explicit
 *             human approval with the finalized details.
 *   'never' — never pause for approval; actions within the sandbox mode and
 *             permission profile proceed (dsh 'never' semantics).
 *
 * The policy is folded from the conversation log exactly like sandbox mode,
 * so it is replayable state, never ambient memory.
 */

import { appendConversationEvent, loadConversationEvents } from './SessionConversations.js';

export const APPROVAL_POLICIES = ['ask', 'never'];
export const DEFAULT_APPROVAL_POLICY = 'ask';

/** Fold the session's approval policy from the log (last one wins). */
export function effectiveApprovalPolicy(convId) {
  try {
    const events = loadConversationEvents(convId, 2000);
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.kind === 'approval/policy' && e.meta && APPROVAL_POLICIES.includes(e.meta.policy)) return e.meta.policy;
    }
  } catch { /* noop */ }
  return DEFAULT_APPROVAL_POLICY;
}

/** Set the session's approval policy (log-backed). */
export function setApprovalPolicy(convId, policy) {
  if (!APPROVAL_POLICIES.includes(String(policy || ''))) {
    return { ok: false, error: `policy must be one of ${APPROVAL_POLICIES.join(', ')}` };
  }
  try {
    appendConversationEvent(convId, { role: 'system', kind: 'approval/policy', text: `approval policy → ${policy}`, meta: { policy } });
  } catch { /* noop */ }
  return { ok: true, policy };
}

/** Whether external-tier actions must pause for approval in this session. */
export function needsApproval(convId) {
  return effectiveApprovalPolicy(convId) !== 'never';
}
