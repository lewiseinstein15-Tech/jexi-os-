/**
 * B180 — SKILL LOOP (Hermes self-improvement, ported).
 * After any agent finishes a task it writes a reusable SKILL as portable
 * markdown (agentskills.io front-matter standard — shareable between
 * profiles). Before a task, agents recall matching skills instead of solving
 * from scratch. Automatic by default; `/refine <name>` forces a save.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR } from '../config.js';
import { loadProfile, foreignSkills } from './AgentProfiles.js';

const SKILLS_ROOT = path.join(DATA_DIR, 'agent-profiles');

function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48); }

/**
 * Save a skill for an agent. agentskills.io shape:
 *   ---
 *   name: kebab-case
 *   description: one line (this is what search matches on)
 *   version: 1
 *   when: "kinds of tasks this applies to"
 *   ---
 *   body
 */
export function saveSkill(agent, { name, description, when, body, source = 'auto' }) {
  const n = slug(name);
  if (!n || !body) return { ok: false, error: 'skill needs a name and body' };
  const dir = path.join(SKILLS_ROOT, agent, 'skills');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${n}.md`);
  const md = [
    '---',
    `name: ${n}`,
    `description: ${String(description || n).slice(0, 200).replace(/\n/g, ' ')}`,
    `version: 1`,
    `when: "${String(when || 'similar tasks').slice(0, 120).replace(/"/g, "'")}"`,
    `agent: ${agent}`,
    `saved: ${new Date().toISOString()}`,
    `source: ${source}`,
    '---',
    '',
    String(body).trim(),
    '',
  ].join('\n');
  fs.writeFileSync(file, md, 'utf-8');
  return { ok: true, file: path.relative(process.cwd(), file), name: n, agent };
}

/** Parse the front-matter of a skill file (portable read). */
export function readSkillMeta(file) {
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) return null;
    const meta = {};
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([a-z_]+):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
    }
    return { ...meta, body: m[2].trim(), file };
  } catch { return null; }
}

/**
 * Recall skills for a task: own store first, then shared stores
 * (config.share_skills). Token match on description + when + name.
 */
export function recallSkills(agent, query, { limit = 3, includeForeign = true } = {}) {
  const tokens = String(query || '').toLowerCase().split(/\W+/).filter((t) => t.length > 3);
  const results = [];
  const dirs = [[agent, path.join(SKILLS_ROOT, agent, 'skills')]];
  if (includeForeign) {
    const p = loadProfile(agent);
    if (p?.config?.memory?.share_skills === 'all') {
      for (const other of fs.existsSync(SKILLS_ROOT) ? fs.readdirSync(SKILLS_ROOT) : []) {
        if (other !== agent) dirs.push([other, path.join(SKILLS_ROOT, other, 'skills')]);
      }
    }
  }
  for (const [owner, dir] of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const meta = readSkillMeta(path.join(dir, f));
      if (!meta) continue;
      const blob = `${meta.name} ${meta.description} ${meta.when}`.toLowerCase();
      const score = tokens.reduce((n, t) => n + (blob.includes(t) ? 1 : 0), 0);
      if (score > 0) results.push({ owner, score, ...meta });
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * AUTO-SAVE after a task (the loop's default-on half): distill the run into
 * a skill. Uses the profile's model when available, else a deterministic
 * template — so the loop NEVER silently skips.
 */
export async function autoSkill(agent, { task, result, envelope }, generate = null) {
  const id = crypto.randomUUID().slice(0, 6);
  let name = `skill-${slug(task).slice(0, 30) || id}`;
  let description = `How JEXI's ${agent} agent handled: ${String(task).slice(0, 120)}`;
  let body = [
    `# Precedent: ${String(task).slice(0, 160)}`,
    '',
    `## What worked`,
    String(result || '').slice(0, 1800),
    envelope?.artifacts?.length ? `\n## Artifacts\n${envelope.artifacts.map((a) => `- ${a}`).join('\n')}` : '',
    '\n(.auto-saved by the skill loop — refine with /refine)',
  ].join('\n');
  if (typeof generate === 'function') {
    try {
      const better = await generate(
        `Distill this completed task into a reusable skill. Task: "${String(task).slice(0, 300)}". Result summary: "${String(result).slice(0, 600)}". Output STRICT markdown: a H1 title, a "## When to use" line, then 3-6 bullet steps of what worked.`,
        'You write terse reusable skill files.',
      );
      if (better && String(better).length > 80) { body = String(better).trim(); name = `skill-${slug(body.match(/^#\s+(.{3,40})/m)?.[1] || task).slice(0, 30) || id}`; }
    } catch { /* deterministic template stands */ }
  }
  return saveSkill(agent, { name, description, when: String(task).slice(0, 100), body, source: 'auto' });
}
