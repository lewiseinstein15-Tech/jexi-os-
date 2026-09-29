/**
 * JEXI OS — tools — domain executor singleton.
 *
 * Built once from registerAllDomains() + makeExecutor(). The real runtime
 * (ToolRuntime.executeTool) dispatches domain slugs through this executor,
 * which applies schema → permission → risk → engine. Because the delegation
 * domain imports AgentLoop (which imports ToolRuntime), this module is loaded
 * lazily via dynamic import to avoid a static ESM cycle.
 *
 * JEXI-010 — this used to hard-code:
 *
 *     makeExecutor({ engines, permissions: { allowAll: true }, risk: { sandboxRing: 'host' } })
 *
 * `allowAll: true` short-circuits the permission gate entirely, so every
 * domain tool (fs_write, fs_delete, term_execute, git_push…) ran regardless of
 * the user's active profile, and `sandboxRing: 'host'` was a label rather than
 * anything the process actually enforced. Domain tools were the one layer
 * where the profile did not apply.
 *
 * Now the active profile is honoured, and the ring is derived from the REAL
 * execution backend rather than asserted. An internal caller that genuinely
 * bypasses the gate must say so explicitly with `ctx.allowUngated: true`,
 * which is recorded in the result.
 */
import { makeExecutor } from '../index.js';
import { hasTool, getTool } from '../registry/ToolRegistry.js';
import { registerAllDomains } from './index.js';
import { detectSandboxBackends } from '../../services/Sandbox.js';

let _domains = null;

export function domainExecutor() {
  if (!_domains) {
    _domains = registerAllDomains();
  }
  // JEXI-017 — publish the domain probe so `toolHasEngine` in ToolRuntime can
  // answer synchronously without a circular import back into this module.
  try {
    const rt = globalThis.__jexiToolRuntime;
    if (rt && typeof rt.registerDomainProbe === 'function') rt.registerDomainProbe({ hasDomainTool, domainToolCount, domainDispatch });
  } catch { /* ToolRuntime not loaded — schemas fall back to registry-only */ }
  return _domains;
}

/** ToolDefinition riskLevel → the profile tier vocabulary ToolRuntime uses. */
const RISK_TO_TIER = { low: 'safe', medium: 'medium', high: 'risky', critical: 'risky' };

/**
 * The risk ceiling a profile implies, as a ToolDefinition riskLevel.
 * Derived from the SAME tier list the main ToolRuntime gates on, so the two
 * layers cannot drift.
 */
const PROFILE_RISK = {
  readonly: 'low',     // safe only
  auto: 'medium',      // safe + medium
  full: 'critical',    // everything
  coding: 'medium',    // safe + medium, plus the sandboxed auto-approvals below
};

/**
 * JEXI-028 — the coding profile's auto-approval set.
 * A "fix the failing test" loop that stops to ask the user before every
 * fs_edit is not autonomous. These are the operations that are confined to
 * the workspace sandbox, so they are auto-approved. Host-destructive work
 * (git_push, fs_delete, term_execute) is deliberately NOT in this list and
 * still requires explicit confirmation.
 */
export const CODING_AUTO_APPROVED = new Set([
  'fs_read', 'fs_write', 'fs_edit', 'fs_append', 'fs_glob', 'fs_grep', 'fs_ls',
  'test_run', 'pytest_run', 'test_coverage',
]);

/** Ring actually enforced by the runtime backend, as a risk-guard ring name. */
function ringForBackend() {
  const caps = detectSandboxBackends();
  if (caps.docker.available) return 'container';
  if (caps.namespaces) return 'container';   // namespace+chroot: host-adjacent but isolated
  return 'host';                             // nothing enforced — say so
}

export function domainDispatch(slug, args, ctx = {}) {
  const domains = domainExecutor();
  const profile = ctx.profile || 'auto';

  // A declared ring is a lower bound the tool needs; the guard allows a tool
  // whose ring is at or below the enforced ring.
  const enforcedRing = ringForBackend();
  /* The ungated path is the only way to reach a tool above the profile's
     ceiling. It used to be honoured on a bare boolean, which meant any caller
     could hand itself a bypass — the "explicit" part was missing. It now
     requires the widest profile AND a confirmation callback, so a host-ring
     destructive call is always something a human agreed to. */
  const ungated = ctx.allowUngated === true
    && profile === 'full'
    && typeof ctx.confirm === 'function';

  // Build the real grant list: every registered domain tool whose declared
  // risk sits inside the profile's ceiling. Passing an empty list would be
  // deny-by-default and block every tool — the opposite of the bug being fixed.
  const tierCeiling = { readonly: 0, auto: 1, coding: 1, full: 2 }[profile] ?? 1;
  const TIER_ORDER = { safe: 0, medium: 1, risky: 2 };
  const allowedTools = domains.engines
    ? Object.keys(domains.engines).filter((name) => {
      const d = getTool(name);
      return d && TIER_ORDER[RISK_TO_TIER[d.riskLevel ?? 'medium']] <= tierCeiling;
    })
    : [];

  const permissions = ungated
    ? { allowAll: true }
    : { maxRisk: PROFILE_RISK[profile] ?? PROFILE_RISK.auto, allowedTools };

  const executor = makeExecutor({
    engines: domains.engines,
    permissions,
    risk: { sandboxRing: enforcedRing },
  });

  // Profile gate: the tool's declared risk must sit inside the profile.
  if (!ungated) {
    const def = getTool(slug);
    const tier = RISK_TO_TIER[def?.riskLevel ?? 'medium'];
    const allowedTiers = {
      readonly: ['safe'],
      auto: ['safe', 'medium'],
      full: ['safe', 'medium', 'risky'],
      coding: ['safe', 'medium'],
    }[profile] ?? ['safe', 'medium'];
    if (!allowedTiers.includes(tier)) {
      return Promise.resolve({
        ok: false, blocked: true, permission: tier, profile,
        error: `permission denied: ${slug} needs ${tier} permission (profile: ${profile}). Switch to Standard or Full in Settings → Tools.`,
      });
    }
  }

  const call = { id: `${slug}-${Date.now().toString(36)}`, name: slug, arguments: args ?? {} };
  return executor.execute(call, {
    ...ctx,
    // JEXI-028 — the coding profile auto-approves the sandboxed edit/test
    // set. Destructive tools simply never appear in it, so they still have to
    // clear the normal confirmation path.
    confirm: ctx.confirm ?? ((profile === 'coding' && CODING_AUTO_APPROVED.has(slug) && !ungated) ? true : ctx.confirm),
    __profile: profile,
    __ungated: ungated,
    __ring: enforcedRing,
  }).then((r) => ({ ...r, profile, sandboxRing: enforcedRing, ungated }));
}

/** Number of domain tools registered (for diagnostics). */
export function domainToolCount() {
  return domainExecutor().engines ? Object.keys(domainExecutor().engines).length : 0;
}

/** True when the slug is an actual registered domain tool. */
export function hasDomainTool(slug) {
  return hasTool(slug);
}

export const _resetDomains = () => { _domains = null; };
