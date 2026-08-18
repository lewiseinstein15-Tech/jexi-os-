/**
 * B137 — PERMISSION PRESETS (DeepSeek Harness
 * `packages/interaction/permission-presets` mirror, JEXI-branded).
 *
 * User-facing preset bundles over the two independent knobs — sandbox mode
 * (read-only | workspace-write | danger-full-access) and approval policy
 * (ask | never). Selecting a preset records a durable `permission/preset`
 * log event AND writes the knobs through their canonical setters, so
 * execution reads the same folds as direct knob changes. The read side is
 * the `permissions` surface for /api/permissions.
 */

import { SANDBOX_MODES, effectiveSandboxMode, setSandboxMode } from './SandboxMode.js';
import { APPROVAL_POLICIES, effectiveApprovalPolicy, setApprovalPolicy } from './UserApproval.js';
import { appendConversationEvent, loadConversationEvents } from './SessionConversations.js';

/** The preset table: sandbox + approval bundles with client presentation. */
export const PERMISSION_PRESETS = {
  assistant: {
    sandbox: 'workspace-write',
    approval: 'ask',
    name: 'Assistant',
    description: 'Write inside the workspace; external actions pause for your approval.',
  },
  autonomous: {
    sandbox: 'workspace-write',
    approval: 'never',
    name: 'Autonomous',
    description: 'Write inside the workspace and proceed without approval pauses (within the sandbox).',
  },
  sandboxed: {
    sandbox: 'read-only',
    approval: 'ask',
    name: 'Sandboxed',
    description: 'Read-only everywhere; nothing can be written or executed.',
  },
  'full-access': {
    sandbox: 'danger-full-access',
    approval: 'ask',
    name: 'Full Access',
    description: 'Everything is reachable; irreversible actions still pause for your approval.',
  },
};

export const CUSTOM_PRESET = 'custom';
export const PERMISSION_PRESET_NAMES = Object.keys(PERMISSION_PRESETS);

/** Fold the session's selected preset from the log (last one wins). */
export function effectivePermissionPreset(convId) {
  try {
    const events = loadConversationEvents(convId, 2000);
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.kind === 'permission/preset' && e.meta && PERMISSION_PRESETS[e.meta.preset]) return e.meta.preset;
    }
  } catch { /* noop */ }
  // Fall back to matching the folded knobs; CUSTOM_PRESET when nothing matches.
  const sandbox = effectiveSandboxMode(convId);
  const approval = effectiveApprovalPolicy(convId);
  for (const [name, spec] of Object.entries(PERMISSION_PRESETS)) {
    if (spec.sandbox === sandbox && spec.approval === approval) return name;
  }
  return CUSTOM_PRESET;
}

/** Apply a preset: record intent + write both knobs through their setters. */
export function setPermissionPreset(convId, preset) {
  const spec = PERMISSION_PRESETS[String(preset || '')];
  if (!spec) return { ok: false, error: `preset must be one of ${PERMISSION_PRESET_NAMES.join(', ')}` };
  try {
    appendConversationEvent(convId, { role: 'system', kind: 'permission/preset', text: `permission preset → ${preset}`, meta: { preset } });
  } catch { /* noop */ }
  setSandboxMode(convId, spec.sandbox);
  setApprovalPolicy(convId, spec.approval);
  return { ok: true, preset, sandbox: spec.sandbox, approval: spec.approval };
}

/** The full permissions read-side for one session. */
export function permissionsStatus(convId) {
  const sandbox = effectiveSandboxMode(convId);
  const approval = effectiveApprovalPolicy(convId);
  const preset = effectivePermissionPreset(convId);
  return {
    ok: true,
    preset,
    sandbox,
    approval,
    presets: Object.entries(PERMISSION_PRESETS).map(([key, spec]) => ({ key, ...spec })),
    sandboxModes: SANDBOX_MODES,
    approvalPolicies: APPROVAL_POLICIES,
  };
}
