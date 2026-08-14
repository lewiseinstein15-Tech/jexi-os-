/**
 * B49 P3/P5 — AUTHORITATIVE REACHABILITY ANALYSIS.
 *
 * This is the codebase telling you whether the catalog is honest, instead of
 * you having to grep for it. It computes, from the live registries:
 *
 *   agents  — every AGENT_ROSTER entry must be reachable: it appears in a
 *             TEAM_PLAN value, a COMPOUND_DETECT phase, or a SkillChain
 *             runSkill pass (SKILL_META keys, alias-resolved).
 *   skills  — every SKILL_REGISTRY entry must be mastered by at least one
 *             agent, and its `agent:` owner must resolve to a real agent.
 *   tools   — every TOOL_REGISTRY entry must list at least one real,
 *             reachable agent (that is what makes auto tool-selection pick it).
 *   refs    — no dangling references in either direction (a slug referenced
 *             in a team/phase/tool must actually exist in the roster).
 *
 * scripts/audit-roster.js runs this and fails CI on any finding; the counts
 * it reports are what AGENT-CATALOG.md is generated from, so the docs can
 * never drift from reality again.
 */
import { AGENT_ROSTER, SKILL_REGISTRY, getAgent, composeTeam } from './AgentRoster.js';
import { TOOL_REGISTRY } from './ToolRegistry.js';
import { TEAM_PLAN, COMPOUND_DETECT } from './Planner.js';
import { SKILL_META, SLUG_ALIASES, resolveSkillSlug } from './SkillChain.js';

/** Resolve a display name ('QA Lead', 'JEXI Core') to a roster slug, the same
 *  way Planner._resolveNames does (norm = lowercase alphanumeric). */
export function resolveDisplayName(name) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const byNorm = new Map(AGENT_ROSTER.map((a) => [norm(a.name), a.slug]));
  const key = norm(name);
  if (byNorm.has(key)) return byNorm.get(key);
  const hit = AGENT_ROSTER.find((a) => norm(a.name).startsWith(key) || key.startsWith(norm(a.name)));
  return hit ? hit.slug : null;
}

/** The set of agent slugs reachable via any composition path. */
export function reachableAgentSlugs() {
  const reachable = new Set();

  // 1. Every TEAM_PLAN value (all intents).
  for (const slugs of Object.values(TEAM_PLAN)) {
    for (const s of slugs) reachable.add(s);
  }

  // 2. Every COMPOUND_DETECT phase agent (display names → slugs).
  for (const c of COMPOUND_DETECT) {
    for (const phase of c.phases || []) {
      for (const name of phase.agents || []) {
        const slug = resolveDisplayName(name);
        if (slug) reachable.add(slug);
      }
    }
  }

  // 3. Every SkillChain runSkill pass slug (SKILL_META keys, alias-resolved).
  for (const slug of Object.keys(SKILL_META)) reachable.add(resolveSkillSlug(slug));

  return reachable;
}

/** Full analysis — every orphan / dangling reference / count. */
export function analyze() {
  const reachable = reachableAgentSlugs();
  const agentSlugs = new Set(AGENT_ROSTER.map((a) => a.slug));
  const skillSlugs = new Set(SKILL_REGISTRY.map((s) => s.slug));

  // Agents: orphaned = defined but unreachable by any path.
  const orphanAgents = AGENT_ROSTER.filter((a) => !reachable.has(a.slug)).map((a) => a.slug);

  // Skills: orphaned = no agent lists it; dangling = owner agent missing.
  const masterOf = new Map();
  for (const a of AGENT_ROSTER) {
    for (const s of a.skills || []) {
      if (!masterOf.has(s)) masterOf.set(s, []);
      masterOf.get(s).push(a.slug);
    }
  }
  const orphanSkills = SKILL_REGISTRY.filter((s) => !(masterOf.get(s.slug) || []).length).map((s) => s.slug);
  const danglingSkillRefs = SKILL_REGISTRY.filter((s) => !getAgent(s.agent)).map((s) => `${s.slug}→${s.agent}`);

  // Tools: dangling = lists a non-existent agent; orphaned = no reachable agent.
  const orphanTools = [];
  const danglingToolRefs = [];
  for (const t of TOOL_REGISTRY) {
    const bad = (t.agents || []).filter((a) => !agentSlugs.has(a));
    if (bad.length) danglingToolRefs.push(`${t.slug}→${bad.join(',')}`);
    const usable = (t.agents || []).filter((a) => reachable.has(a));
    if (!usable.length) orphanTools.push(t.slug);
  }

  // Dangling refs in TEAM_PLAN / compound phases.
  const danglingTeamRefs = [];
  for (const [intent, slugs] of Object.entries(TEAM_PLAN)) {
    for (const s of slugs) if (!agentSlugs.has(s)) danglingTeamRefs.push(`${intent}→${s}`);
  }
  for (const c of COMPOUND_DETECT) {
    for (const phase of c.phases || []) {
      for (const name of phase.agents || []) {
        if (!resolveDisplayName(name)) danglingTeamRefs.push(`compound:${phase.name}→${name}`);
      }
    }
  }

  // A skill referenced by an agent but missing from the registry.
  const danglingAgentSkills = [];
  for (const a of AGENT_ROSTER) {
    for (const s of a.skills || []) if (!skillSlugs.has(s)) danglingAgentSkills.push(`${a.slug}→${s}`);
  }

  const agentTotal = AGENT_ROSTER.length;
  const reachablePct = Math.round(((agentTotal - orphanAgents.length) / agentTotal) * 1000) / 10;

  return {
    counts: {
      agents: agentTotal,
      skills: SKILL_REGISTRY.length,
      tools: TOOL_REGISTRY.length,
      reachableAgents: agentTotal - orphanAgents.length,
      reachablePct,
      intents: Object.keys(TEAM_PLAN).length,
    },
    orphanAgents,
    orphanSkills,
    danglingSkillRefs,
    orphanTools,
    danglingToolRefs,
    danglingTeamRefs,
    danglingAgentSkills,
    reachable,
    clean:
      orphanAgents.length === 0 &&
      orphanSkills.length === 0 &&
      danglingSkillRefs.length === 0 &&
      orphanTools.length === 0 &&
      danglingToolRefs.length === 0 &&
      danglingTeamRefs.length === 0 &&
      danglingAgentSkills.length === 0,
  };
}

/**
 * B49 P2/P4 — HONEST EXECUTION MODEL. The roster is big, but not every team
 * member gets its own LLM pass. This is the source of truth the plan event
 * and AGENT-CATALOG.md use to say which agents reasoned independently:
 *
 *   independent — the agent's pass is its own observable call (its own graph
 *                 node or its own runSkill/LLM call with its own verdict).
 *   bundled     — the agent's persona is composed INTO another pass (its
 *                 expertise is injected as role text, but it does not take
 *                 an independent reasoning turn).
 *
 * Verified independent passes today: the code_task pipeline (planForBuild's
 * Product/Designer/Engineer calls, Architect+Coder+Debugger codegen/fix
 * calls, Runner's real execution, and the QA/Reviewer/Security/Critic/
 * Shipper/Reflector gate passes — each an own call with its own verdict).
 * Everything else in every team is honestly marked bundled (composite).
 */
export const INDEPENDENT_PASS_SLUGS = new Set([
  'product', 'designer', 'engineer', // planForBuild: three sequential runSkill calls
  'architect', 'coder', 'debugger',  // generateCode / applyFix LLM calls
  'runner',                          // real sandbox execution (observable output)
  'qa', 'reviewer', 'security', 'critic', 'shipper', 'reflector', // own gate passes
]);

/** Per-intent execution model: which team members ran independently vs bundled. */
export function executionModel(intent, extra = {}) {
  const team = composeTeam(intent, extra);
  const independent = team.filter((a) => INDEPENDENT_PASS_SLUGS.has(a.slug)).map((a) => a.slug);
  const bundled = team.filter((a) => !INDEPENDENT_PASS_SLUGS.has(a.slug)).map((a) => a.slug);
  return { independent, bundled };
}

/** One-line summary for logs: "206 agents · 492 skills · 152 tools · 100% reachable". */
export function reachabilitySummary() {
  const r = analyze();
  return `${r.counts.agents} agents · ${r.counts.skills} skills · ${r.counts.tools} tools · ${r.counts.reachablePct}% agents reachable`;
}
