/**
 * JEXI OS — AAS CORE — catalog.js
 *
 * Read-only local catalog over the repo's skills tree: scans
 * `skills/**\/SKILL.md`, parses ONLY front-matter metadata
 * (name, description, whenToUse — same parser family as the JEXI skill
 * engine), and exposes list/get/search. Never writes. Never throws on a
 * malformed skill — it is skipped and counted in `diagnostics`.
 *
 * Exports: { list(), get(id), search(query), diagnostics }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
export const SKILLS_ROOT = process.env.JEXI_AAS_SKILLS_ROOT || path.join(REPO_ROOT, 'skills');

export function parseFrontmatter(md) {
  if (!md.startsWith('---\n')) return { metadata: {}, body: md };
  const end = md.indexOf('\n---\n', 4);
  if (end === -1) return { metadata: {}, body: md };
  const fm = md.slice(4, end);
  const metadata = {};
  for (const line of fm.split('\n')) {
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      metadata[m[1]] = value.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      metadata[m[1]] = value.replace(/^["']|["']$/g, '');
    }
  }
  return { metadata, body: md.slice(end + 5) };
}

function* walkMd(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'aas') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walkMd(p);
    else if (ent.name === 'SKILL.md') yield p;
  }
}

function loadAll() {
  const skills = [];
  const diagnostics = { scanned: 0, skipped: [] };
  for (const file of walkMd(SKILLS_ROOT)) {
    diagnostics.scanned += 1;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const { metadata } = parseFrontmatter(raw);
      const id = String(metadata.name || path.basename(path.dirname(file))).trim();
      if (!id || !metadata.description) throw new Error('missing name or description front-matter');
      skills.push({
        id,
        name: id,
        description: String(metadata.description),
        whenToUse: String(metadata.whenToUse || ''),
        version: metadata.version ? String(metadata.version) : null,
        path: path.relative(REPO_ROOT, file).split(path.sep).join('/'),
      });
    } catch (e) {
      diagnostics.skipped.push({ path: path.relative(REPO_ROOT, file), reason: e.message });
    }
  }
  skills.sort((a, b) => a.id.localeCompare(b.id));
  return { skills, diagnostics };
}

let cache = null;
function fresh() { cache = loadAll(); return cache; }
export function reload() { return fresh(); }

export function list() {
  const { skills } = cache ?? fresh();
  return skills.map(({ id, name, description, path }) => ({ id, name, description, path }));
}

export function get(id) {
  const { skills } = cache ?? fresh();
  return skills.find((s) => s.id === id) ?? null;
}

const STOP = new Set(['a', 'an', 'the', 'for', 'with', 'and', 'or', 'of', 'to', 'in', 'on', 'when', 'use', 'before', 'any']);

export function search(query) {
  const { skills } = cache ?? fresh();
  const tokens = String(query).toLowerCase().split(/[^a-z0-9+#.-]+/).filter((t) => t.length > 1 && !STOP.has(t));
  if (!tokens.length) return [];
  const scored = skills.map((s) => {
    let score = 0;
    for (const t of tokens) {
      if (s.id.toLowerCase().includes(t)) score += 3;
      if (s.description.toLowerCase().includes(t)) score += 2;
      if (s.whenToUse.toLowerCase().includes(t)) score += 1;
      // initialism match: "tdd" ↔ test-driven-development, "a11y" style short
      // forms — the acronym of the hyphen-separated id counts as a strong hit
      if (initialism(s.id) === t) score += 5;
    }
    return { s, score };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || a.s.id.localeCompare(b.s.id));
  return scored.map((x) => x.s);
}

/** Initialism of an id: "test-driven-development" → "tdd". */
export function initialism(id) {
  const parts = String(id).toLowerCase().split(/[-_ ]+/).filter(Boolean);
  return parts.length >= 2 ? parts.map((p) => p[0]).join('') : '';
}

export function diagnostics() {
  const { diagnostics } = cache ?? fresh();
  return diagnostics;
}
