/**
 * JEXI OS — tools — capability domain.
 *
 * `capability_check` is how the agent answers "can I actually do this here?"
 * without guessing from its system prompt. It reports the four-state model
 * (exists / registered / available / succeeded) from the live registry, plus
 * what has really worked this session.
 *
 * This is a READ tool with no side effects. It does not test-fire capabilities
 * (that would be an unreviewed external action); it reports the registry's
 * computed state, which is derived from real engines, the active permission
 * profile, MCP server health, and the evidence ledger.
 */
import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';
import { listCapabilityStatesAsync, capabilitySummaryAsync } from '../../../capability/registry/registry.js';
import { inferRequirements } from '../../../capability/registry/requirements.js';
import { succeededCapabilities, refusedCapabilities, failedCapabilities, ledgerEvents } from '../../../capability/registry/ledger.js';

/** Does a free-text probe match this capability's id, title or guidance? */
function matches(c, probe) {
  const p = String(probe || '').toLowerCase().trim();
  if (!p) return true;
  return c.id.includes(p)
    || p.includes(c.id)
    || String(c.title || '').toLowerCase().includes(p)
    || String(c.whenToUse || '').toLowerCase().includes(p)
    || p.split(/\s+/).some((w) => w.length > 3 && c.id.includes(w));
}

export function registerCapabilityTools() {
  const check = defineTool({
    name: 'capability_check',
    description:
      'Check what JEXI can actually do in THIS session. Reports each capability\'s state '
      + '(available / registered-only / missing), why an unavailable one is unavailable, and '
      + 'what has already succeeded. Call this before telling a user that something is or is not '
      + 'possible, instead of relying on memory of the system prompt.',
    riskLevel: 'low',
    runtimeRing: 1,
    idempotent: true,
    parameters: {
      type: 'object',
      properties: {
        capability: {
          type: 'string',
          desc: 'Optional capability id or keyword (e.g. "web_search", "terminal", "files"). Omit for all.',
        },
        forTask: {
          type: 'string',
          desc: 'Optional: the task you are about to attempt; returns which capabilities it requires and whether each is available.',
        },
      },
    },
  });
  const unreg = registerToolBatch([check]);

  const engines = {
    async capability_check({ capability, forTask } = {}, ctx = {}) {
      /* Use the profile the EXECUTOR is actually enforcing, not the settings
         default. The executor sets `__profile` from the profile it gated on, so
         a check run under `readonly` must not report a write capability as
         available — a false positive here is exactly the dishonest claim this
         registry exists to prevent. */
      const profile = ctx.__profile || ctx.profile || undefined;
      const summary = await capabilitySummaryAsync(profile ? { profile } : {});

      // Task mode: report exactly what this task needs and what is missing.
      if (forTask) {
        const inferred = inferRequirements(forTask, {});
        const states = await listCapabilityStatesAsync(profile ? { profile } : {});
        const byId = new Map(states.map((c) => [c.id, c]));
        const needs = inferred.required.map((id) => {
          const c = byId.get(id);
          return {
            capability: id,
            available: Boolean(c?.available),
            executable: Boolean(c?.executable),
            state: c?.state ?? null,
            blockedBy: c?.blockedBy ?? [],
            reason: c?.reason ?? 'not_in_catalog',
            whenToUse: c?.whenToUse ?? null,
          };
        });
        const missing = needs.filter((n) => !n.available);
        return {
          ok: true,
          mode: 'task',
          task: forTask,
          required: needs,
          missing,
          canProceed: missing.length === 0,
          note: missing.length
            ? `Cannot fully do this here: ${missing.map((m) => m.capability).join(', ')} unavailable. Say so instead of attempting it.`
            : 'All required capabilities are available in this session.',
          profile: summary.profile,
        };
      }

      // Capability mode: one capability, or the full list.
      const all = summary.capabilities.filter((c) => matches(c, capability));
      const proven = succeededCapabilities();
      const refused = refusedCapabilities();
      const broken = failedCapabilities();

      return {
        ok: true,
        mode: capability ? 'capability' : 'summary',
        profile: summary.profile,
        counts: {
          total: summary.total,
          available: summary.available,
          // Phase 2A — `available` is the deprecated alias for "the runtime
          // guard permits it". These two make the distinction explicit so a
          // caller never reads a ring-blocked tool as runnable.
          executable: summary.executable,
          ringBlocked: summary.ringBlocked,
          registeredOnly: summary.registered,
          missing: summary.unavailable,
          succeeded: summary.succeeded,
        },
        sandboxRing: summary.sandboxRing,
        capabilities: all.map((c) => ({
          id: c.id,
          title: c.title,
          whenToUse: c.whenToUse,
          state: c.state,
          available: c.available,
          executable: c.executable,
          reachable: c.reachable,
          registered: c.registered,
          discoverable: c.discoverable,
          permitted: c.permitted,
          blockedBy: c.blockedBy,
          succeededThisSession: proven.has(c.id),
          refusedThisSession: refused.has(c.id),
          failedThisSession: broken.has(c.id),
          reason: c.reason,
        })),
        recentOutcomes: ledgerEvents().slice(-10).map((e) => ({ tool: e.tool, capability: e.capability, outcome: e.outcome })),
      };
    },
  };

  return { unreg, engines };
}
