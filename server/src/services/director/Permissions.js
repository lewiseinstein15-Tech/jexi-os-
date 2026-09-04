/**
 * B209 — PERMISSION GATE: every tool an employee can touch goes through
 * here. Declared permissions (READ / WRITE / EXECUTE / NETWORK / GIT /
 * DESTRUCTIVE) are ENFORCED, not decorative — a tool whose requirement the
 * employee lacks is refused with a PERMISSION_DENIED event and never runs.
 * Destructive tools are additionally hard-blocked unless the employee's
 * profile explicitly carries DESTRUCTIVE.
 */

const TOOL_REQUIREMENTS = {
  'web-search': ['READ', 'NETWORK'],
  'memory-recall': ['READ'],
  'rolling-summary': ['READ'],
  'episode-recall': ['READ'],
  'semantic-search': ['READ'],
  'knowledge-save': ['READ', 'WRITE'],
  'file-write': ['READ', 'WRITE'],
  'run-command': ['READ', 'EXECUTE'], // B210 — the employee command runner (allowlisted, sandboxed)
  'browser-act': ['READ', 'COMPUTER'], // B211 B3 — real virtual-desktop browser driving
  'file-read': ['READ'],
  'git-commit': ['READ', 'WRITE', 'GIT'],
  'shell-run': ['READ', 'EXECUTE'],
  // anything matched here can never run for an employee, regardless of profile
  'disk-wipe': ['DESTRUCTIVE'],
  'force-delete': ['DESTRUCTIVE'],
};

export function toolPermissionsFor(slug) {
  return TOOL_REQUIREMENTS[String(slug || '').toLowerCase()] || ['READ'];
}

/**
 * Check whether an employee may run a tool.
 * @returns {{allowed: boolean, reason?: string, missing?: string[]}}
 */
export function checkToolPermission(employee, slug) {
  const clean = String(slug || '').toLowerCase();
  if (!employee) return { allowed: false, reason: 'no employee context' };
  if (!Array.isArray(employee.supportedTools) || !employee.supportedTools.some((t) => String(t).toLowerCase() === clean)) {
    return { allowed: false, reason: `${employee.displayName} is not staffed for the "${clean}" tool` };
  }
  const perms = new Set((employee.permissions || []).map((p) => String(p).toUpperCase()));
  const required = toolPermissionsFor(clean);
  const missing = required.filter((r) => !perms.has(r));
  if (missing.length) {
    return { allowed: false, reason: `${employee.displayName} lacks the ${missing.join('+')} permission for "${clean}"`, missing };
  }
  return { allowed: true };
}
