/**
 * JEXI OS — capability registry — requirement-driven tool selection.
 *
 * Turns inferred requirements into the concrete tool slugs a turn must be
 * offered, verified against the live registry so a dead slug is never offered.
 *
 * This is the merge that fixes the reported symptom. The offered set becomes
 *
 *     plan.tools  ∪  available tools for the task's REQUIRED capabilities
 *                 ∪  always-available control tools
 *
 * rather than `plan.tools` alone. A classification error can now withhold
 * nothing the request plainly asks for: if the user said "read the file", a
 * filesystem tool is offered whether or not the classifier called the request
 * `legal_task`.
 *
 * Required tools are labelled `explicit` when they come from the user's own
 * words, and `intent-default` when they come from the coding-intent floor. The
 * distinction matters downstream: an explicit requirement outranks the coding
 * tool cap, an intent default does not.
 */
import { inferRequirements } from './requirements.js';
import { describeCapability, primeCapabilities } from './registry.js';
import { resolveToolDef, toolHasEngine } from '../../services/ToolRuntime.js';

/**
 * @param {object} o
 * @param {string} o.query
 * @param {object} [o.plan]
 * @param {string} [o.profile]  override the active tool profile
 * @param {boolean} [o.expandAll=false]  offer every provider, not just the first
 * @returns {Promise<{
 *   tools: {slug:string, capability:string, why:string, explicit:boolean}[],
 *   required: string[],
 *   unavailable: {capability:string, reason:string}[],
 *   notes: string[],
 *   reasons: object[],
 * }>}
 */
export async function selectCapabilityTools({ query, plan = {}, profile, expandAll = false } = {}) {
  await primeCapabilities();

  const inferred = inferRequirements(query, plan);
  const tools = [];
  const seen = new Set();
  const unavailable = [];
  const notes = [];

  // Note: a plan tool does NOT mean the capability is satisfied. The plan's
  // tools are filtered again later (active skill, coding cap), so a capability
  // the request explicitly needs is still recorded and protected here. Dedupe
  // happens through `seen` below.
  for (const reason of inferred.reasons) {
    const { capability, why, id } = reason;
    const explicit = id !== 'coding-intent';

    const d = describeCapability(capability, profile ? { profile } : {});
    if (!d.available) {
      unavailable.push({ capability, reason: d.reason });
      continue;
    }

    /* MINIMAL SET by default: the first available provider satisfies the
       capability. Offering every provider of every required capability is how
       a "read a file" request ends up holding `fs_delete` — a high-risk tool
       nobody asked for. The request's own words are the floor, not a licence to
       widen the surface. `expandAll` exists for callers that genuinely want
       the full set. */
    const candidates = d.providers.filter((p) => p.available && p.tool && resolveToolDef(p.tool) && toolHasEngine(p.tool));
    const chosen = expandAll ? candidates : candidates.slice(0, 1);

    let added = 0;
    for (const p of chosen) {
      if (seen.has(p.tool)) continue;
      seen.add(p.tool);
      tools.push({ slug: p.tool, capability, why, explicit });
      added += 1;
    }
    if (!added && !unavailable.some((u) => u.capability === capability)) {
      unavailable.push({ capability, reason: d.reason });
    }
  }

  if (tools.length) {
    const names = [...new Set(tools.map((t) => t.capability))];
    notes.push(`capability requirements added ${tools.length} tool(s) for: ${names.join(', ')}`);
  }
  for (const u of unavailable) {
    notes.push(`required capability "${u.capability}" is NOT available (${u.reason}) — the answer must not claim it`);
  }

  return {
    tools,
    required: inferred.required,
    satisfiedByPlan: inferred.satisfiedByPlan,
    unavailable,
    notes,
    reasons: inferred.reasons,
  };
}
