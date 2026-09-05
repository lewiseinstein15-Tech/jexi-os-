/**
 * JEXI OS — SKILLS SYSTEM (AGI Phase 8, adapted from Hermes' idea of skills
 * as first-class versioned artifacts — JEXI's own implementation).
 *
 * A skill (spec §34) is a versioned, validated, reusable procedure:
 *   { name, version, status: draft|validated|active, description,
 *     requirements, procedure[], tools[], examples[], failureModes[],
 *     verification }
 *
 * Learning (spec §35): a lesson from a successful recovery can be extracted
 * into a DRAFT skill. A draft is never used until validated (shape + tool
 * references real + procedure concrete) and explicitly promoted — no
 * uncontrolled self-modification of production behavior.
 *
 * Storage: skills/*.json in the repository (seeded, reviewed) plus learned
 * drafts under DATA_DIR/skills/ (validated before use).
 */

import fs from 'node:fs';
import path from 'node:path';

const SEED_DIR = () => new URL('../../../skills/', import.meta.url).pathname;
const LEARNED_DIR = () => path.join(process.env.DATA_DIR || './data', 'skills');

export const SKILL_STATUSES = ['draft', 'validated', 'active'];

export function validateSkill(skill) {
  const problems = [];
  if (!skill || typeof skill !== 'object') return { ok: false, problems: ['skill must be an object'] };
  if (!skill.name || !/^[a-z][a-z0-9-]{2,40}$/.test(skill.name)) problems.push('name must be kebab-case, 3-40 chars');
  if (!Number.isInteger(skill.version) || skill.version < 1) problems.push('version must be a positive integer');
  if (!String(skill.description || '').trim()) problems.push('description is required');
  if (!Array.isArray(skill.procedure) || skill.procedure.length < 2) problems.push('procedure needs at least 2 steps');
  if (skill.procedure && skill.procedure.some((s) => typeof s !== 'string' || s.trim().length < 5)) problems.push('every procedure step must be a real sentence');
  if (!Array.isArray(skill.tools) || skill.tools.length === 0) problems.push('tools must list at least one tool id');
  if (!Array.isArray(skill.failureModes) || skill.failureModes.length === 0) problems.push('failureModes must list at least one known way this skill goes wrong');
  if (!String(skill.verification || '').trim()) problems.push('verification is required — how do we KNOW the skill worked');
  if (skill.status && !SKILL_STATUSES.includes(skill.status)) problems.push(`unknown status '${skill.status}'`);
  return { ok: problems.length === 0, problems };
}

function readSkillFiles(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const skill = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      out.push({ ...skill, origin: path.basename(f) });
    } catch { /* malformed file skipped, never crashes the system */ }
  }
  return out;
}

/** All skills: seeded (repo) + learned (DATA_DIR). Malformed files are skipped honestly. */
export function listSkills() {
  return [...readSkillFiles(SEED_DIR()), ...readSkillFiles(LEARNED_DIR())];
}

/** Only skills that passed validation AND are validated/active. */
export function usableSkills() {
  return listSkills().filter((s) => {
    const v = validateSkill(s);
    return v.ok && (s.status === 'validated' || s.status === 'active');
  });
}

/** Retrieve skills whose procedure/tools match a task (simple, honest token match). */
export function findSkillsFor(query, { limit = 3 } = {}) {
  const q = String(query).toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  if (!q.length) return [];
  return usableSkills()
    .map((s) => {
      const hay = `${s.name} ${s.description} ${s.procedure.join(' ')}`.toLowerCase();
      return { ...s, score: q.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0) };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Validate + promote a skill (draft → validated). Refuses invalid skills. */
export function promoteSkill(skill) {
  const v = validateSkill(skill);
  if (!v.ok) return { ok: false, problems: v.problems };
  const existing = listSkills().filter((s) => s.name === skill.name);
  const nextVersion = existing.length ? Math.max(...existing.map((s) => s.version || 1)) + 1 : 1;
  const promoted = { ...skill, version: nextVersion, status: 'validated', validatedAt: new Date().toISOString() };
  try {
    fs.mkdirSync(LEARNED_DIR(), { recursive: true });
    fs.writeFileSync(path.join(LEARNED_DIR(), `${promoted.name}.json`), JSON.stringify(promoted, null, 2));
  } catch (e) {
    return { ok: false, problems: [`could not persist: ${e.message}`] };
  }
  return { ok: true, skill: promoted };
}

/**
 * Skill LEARNING (spec §35): extract a draft skill from a mission lesson.
 * The draft is stored but NOT usable until validated + promoted.
 */
export function learnSkillFromLesson(lesson) {
  const l = lesson || {};
  if (!l.lesson || !l.strategy) return { ok: false, problems: ['lesson needs both .lesson and .strategy'] };
  const name = `learned-${String(l.missionId || 'mission').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}-${Date.now().toString(36).slice(-4)}`;
  const draft = {
    name,
    version: 1,
    status: 'draft',
    description: String(l.lesson).slice(0, 300),
    requirements: ['the same situation that produced the lesson'],
    procedure: [
      String(l.failure || 'the original failure').slice(0, 300),
      `Avoid the cause: ${String(l.cause || 'the diagnosed cause').slice(0, 300)}`,
      `Apply the strategy that worked: ${String(l.strategy).slice(0, 300)}`,
    ],
    tools: ['native:web-search'],
    examples: [],
    failureModes: ['extracted from a single mission — may not generalize until validated'],
    verification: String(l.lesson).slice(0, 200),
    learnedFrom: { missionId: l.missionId || null, kind: l.kind || null, at: new Date().toISOString() },
  };
  try {
    fs.mkdirSync(LEARNED_DIR(), { recursive: true });
    fs.writeFileSync(path.join(LEARNED_DIR(), `${name}.json`), JSON.stringify(draft, null, 2));
  } catch (e) {
    return { ok: false, problems: [`could not persist: ${e.message}`] };
  }
  return { ok: true, skill: draft, note: 'draft stored — NOT usable until validated and promoted' };
}
