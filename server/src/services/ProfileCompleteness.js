/**
 * B191 — PROFILE COMPLETENESS (every single agent has a profile).
 *
 * The 5 named Hermes profiles (orchestrator/dev/research/comms/scheduler)
 * are hand-crafted. The other ~209 planner-deployable roster roles get
 * AUTO-GENERATED profiles derived from the AgentRoster registry — same
 * Hermes shape (config.yaml + SOUL.md + isolated memory), generated lazily
 * on first use and cached on disk so they survive restarts:
 *
 *   ensureProfile(role)  → { name, config, soul, dir, generated: true }
 *   profileCoverage()   → { named, generated, missing }
 *
 * Generated SOULs use the roster's own mandate/skills text (no invented
 * personality) and inherit safe defaults; any generated profile can be
 * replaced later by dropping a hand-written folder in agents/profiles/.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR } from '../config.js';
import { loadProfile, listProfiles, parseSimpleYaml } from './AgentProfiles.js';
import { AGENT_ROSTER } from './AgentRoster.js';

const NAMED_DIR = path.join(process.cwd(), 'agents', 'profiles');
const AUTO_DIR = path.join(DATA_DIR, 'agent-profiles', 'auto');

/* ── roster metadata lookup (the roster is a list; index by slug) ── */
const ROSTER_BY_SLUG = new Map(
  Object.values(AGENT_ROSTER || {})
    .filter((e) => e && e.slug)
    .map((e) => [String(e.slug).toLowerCase(), e]),
);
function rosterMeta(role) {
  const slug = String(role || '').toLowerCase();
  const hit = ROSTER_BY_SLUG.get(slug);
  return hit ? { slug, ...hit } : { slug };
}

function soulFor(meta) {
  const name = (meta.name || meta.slug || 'agent').replace(/-/g, ' ');
  const role = meta.role || meta.mandate || meta.description || '';
  const skills = (meta.skills || []).slice(0, 8);
  return `# ${titleCase(name)}

I am the **${titleCase(name)}** of JEXI's specialist roster.

## What I own
${role ? String(role).slice(0, 400) : 'My mandate is defined by the team that deploys me.'}

## My discipline
- I do my part of the plan and hand back a structured result.
- Before starting I check my skill store for precedent.
- After finishing, what worked is saved as a skill for next time.
${skills.length ? `\n## Skills I bring\n${skills.map((s) => `- ${s}`).join('\n')}` : ''}

*(auto-generated profile — replace by dropping a hand-written folder in agents/profiles/${meta.slug})*
`;
}

function titleCase(s) { return String(s).replace(/\b\w/g, (c) => c.toUpperCase()); }

/**
 * Get-or-create a profile for ANY roster role. Hand-written named profiles
 * win; generated profiles persist to DATA_DIR/agent-profiles/auto/<role>/.
 */
export function ensureProfile(role) {
  const named = loadProfile(String(role || '').toLowerCase());
  if (named) return { ...named, generated: false };

  const meta = rosterMeta(role);
  const slug = meta.slug;
  if (!slug) return null;
  const dir = path.join(AUTO_DIR, slug);
  const cfgPath = path.join(dir, 'config.yaml');
  const soulPath = path.join(dir, 'SOUL.md');

  if (!fs.existsSync(cfgPath)) {
    fs.mkdirSync(dir, { recursive: true });
    // inherit the closest named profile's lane by domain
    const lane = laneFor(slug);
    fs.writeFileSync(cfgPath, [
      `name: ${slug}`,
      `display_name: ${titleCase(slug.replace(/-/g, ' '))}`,
      'role: subordinate',
      'model:',
      `  prefer: ${lane}`,
      '  temperature: 0.3',
      'tools:',
      '  allow: [web_search, deep_read, skill_save, skill_search, memory_write, agent_ask]',
      'budget:',
      '  max_iterations: 8',
      '  max_output_tokens: 4000',
      'platforms: [chat, gateway]',
      'memory:',
      '  store: per-agent',
      '  share_skills: all',
      `generated: ${new Date().toISOString()}`,
    ].join('\n'), 'utf-8');
    fs.writeFileSync(soulPath, soulFor(meta), 'utf-8');
  }
  // load through the normal loader by pointing it at the auto dir
  const profile = {
    name: slug,
    dir,
    displayName: titleCase(slug.replace(/-/g, ' ')),
    role: 'subordinate',
    config: parseSimpleYaml(fs.readFileSync(cfgPath, 'utf-8')),
    soul: fs.readFileSync(soulPath, 'utf-8'),
    generated: true,
  };
  return profile;
}

function laneFor(slug) {
  if (/coder|developer|engineer|backend|frontend|api|database|devops|security|app-?sec|qa|debug|release|kubernetes|terraform|sre|infra|cloud|deploy|mobile|android|ios|react/.test(slug)) return 'nvidia';
  if (/research|scholar|science|history|study|analyst|data|market|news|fact|report|bi/.test(slug)) return 'gemini';
  if (/writer|editor|copy|poet|novel|screen|blog|content|brand|social|marketing|seo/.test(slug)) return 'mistral';
  return 'groq';
}

/** Eagerly generate a profile for EVERY planner-deployable role (idempotent). */
export function generateAllProfiles(deployedRoles = null) {
  let roles = deployedRoles;
  if (!roles) {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/services/Planner.js'), 'utf8');
    const m = src.match(/export const TEAM_PLAN = \{([\s\S]*?)\n\};/);
    roles = [...m[1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]);
  }
  const made = [];
  for (const r of new Set(roles)) {
    if (r === 'orchestrator') continue;
    const p = ensureProfile(r);
    if (p?.generated) made.push(p.name);
  }
  return made;
}

/** Coverage report: named + generated vs the full planner-deployed set. */
export function profileCoverage(deployedRoles = null) {
  const named = listProfiles().map((p) => p.name);
  let roles = deployedRoles;
  if (!roles) {
    // derive from the planner source (same as the audit tool)
    const src = fs.readFileSync(path.join(process.cwd(), 'src/services/Planner.js'), 'utf8');
    const m = src.match(/export const TEAM_PLAN = \{([\s\S]*?)\n\};/);
    roles = [...m[1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]);
  }
  const distinct = [...new Set(roles)].filter((r) => r && r !== 'orchestrator');
  const rosterKeys = ROSTER_BY_SLUG;
  const missing = distinct.filter((r) =>
    !named.includes(r)
    && !fs.existsSync(path.join(AUTO_DIR, r, 'config.yaml'))
    && !rosterKeys.has(r)
  );
  const covered = distinct.length - missing.length;
  return { named, deployedRoles: distinct.length, covered, coverable: distinct.length, missing: missing.slice(0, 20) };
}
