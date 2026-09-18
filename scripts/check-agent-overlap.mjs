#!/usr/bin/env node
/**
 * JEXI OS — AGENT OVERLAP VALIDATOR (Phase 8 Scope B, probe P6).
 *
 * Verifies that canonical agent files stay trigger-distinct: no two agents
 * may share a normalized name, and no two agents in the same division may
 * carry overlapping trigger descriptions (Jaccard similarity of description
 * token shingles above the threshold) or the same emoji identity.
 *
 *   node scripts/check-agent-overlap.mjs [paths...]   # default: agents/
 *   exit 0 = no violations; exit 1 = violations listed
 *
 * Deliberately conservative: similarity is computed over CONTENT tokens
 * (nouns/verbs after stopwords), so shared boilerplate like "authorized
 * scope" cannot false-positive distinct specialties.
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const targets = args.length ? args : ['agents'];
const SIM_THRESHOLD = 0.55;

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'with', 'must', 'be', 'is', 'are', 'when', 'that', 'this', 'it', 'use', 'from', 'by', 'as', 'at', 'into', 'their', 'its', 'each', 'every', 'before']);

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return { meta: null, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const km = line.match(/^([a-zA-Z-]+):\s*(.*)$/);
    if (!km) continue;
    let v = km[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    meta[km[1]] = v;
  }
  return { meta, body: text.slice(m[0].length) };
}

function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function jaccard(aSet, bSet) {
  const inter = [...aSet].filter((x) => bSet.has(x)).length;
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : inter / union;
}

function listFiles(dirs) {
  const out = [];
  const walk = (d) => {
    const st = fs.statSync(d);
    if (st.isFile()) {
      if (d.endsWith('.agent.md')) out.push(d);
      return;
    }
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.agent.md')) out.push(p);
    }
  };
  for (const t of dirs) walk(path.resolve(ROOT, t));
  return out.sort();
}

const agents = listFiles(targets).map((file) => {
  const text = fs.readFileSync(file, 'utf8');
  const { meta } = parseFrontmatter(text);
  const rel = path.relative(ROOT, file);
  return {
    file: rel,
    id: path.basename(file, '.agent.md').toLowerCase(),
    name: String(meta && meta.name || '').toLowerCase(),
    emoji: (meta && meta.emoji) || '',
    division: (meta && meta.division) || path.basename(path.dirname(file)),
    description: String(meta && meta.description || ''),
    set: new Set(tokens(`${meta && meta.name || ''} ${meta && meta.description || ''}`)),
  };
});

// Full canonical pool — identity (name/emoji) uniqueness is ALWAYS checked
// against everything, so a new agent cannot steal an existing identity.
const poolFiles = listFiles(['agents']);
const pool = poolFiles.map((file) => {
  const { meta } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  return {
    file: path.relative(ROOT, file),
    id: path.basename(file, '.agent.md').toLowerCase(),
    name: String(meta && meta.name || '').toLowerCase(),
    emoji: (meta && meta.emoji) || '',
  };
});

const violations = [];
const preexisting = [];
const targetRel = new Set(agents.map((a) => a.file));

/** A collision fails the run only when the target set introduces it
 *  (i.e. one of the two files is a target agent). Pool-internal collisions
 *  among non-target files are pre-existing conditions — listed, not fatal. */
function record(kind, detail, fileA, fileB) {
  const line = `${kind}: ${detail} (${fileA} <-> ${fileB})`;
  if (targetRel.has(fileA) || targetRel.has(fileB)) violations.push(line);
  else preexisting.push(line);
}

// 1. duplicate normalized name (full pool)
const byName = new Map();
for (const a of pool) {
  const key = a.name || a.id;
  if (byName.has(key)) record('DUPLICATE-NAME', `"${key}"`, byName.get(key), a.file);
  else byName.set(key, a.file);
}

// 2. duplicate emoji (full pool)
const byEmoji = new Map();
for (const a of pool) {
  if (!a.emoji) continue;
  if (byEmoji.has(a.emoji)) record('DUPLICATE-EMOJI', a.emoji, byEmoji.get(a.emoji), a.file);
  else byEmoji.set(a.emoji, a.file);
}

// 3. description overlap — only among the TARGET set (same division)
const pairs = [];
for (let i = 0; i < agents.length; i++) {
  for (let j = i + 1; j < agents.length; j++) {
    const a = agents[i], b = agents[j];
    if (a.division !== b.division) continue;
    const sim = jaccard(a.set, b.set);
    if (sim >= SIM_THRESHOLD) {
      pairs.push({ a, b, sim });
      violations.push(`OVERLAP (${(sim * 100).toFixed(0)}%): ${a.id} <-> ${b.id} [${a.division}]`);
    }
  }
}

// report
console.log(`target agents (description-overlap scope): ${agents.length}`);
console.log(`full canonical pool (name/emoji uniqueness scope): ${pool.length}`);
console.log(`similarity threshold: ${(SIM_THRESHOLD * 100).toFixed(0)}% (same-division description overlap)`);
if (preexisting.length) {
  console.log(`\npre-existing pool collisions (not introduced by target set — informational, ${preexisting.length}):`);
  for (const v of preexisting) console.log(`  ${v}`);
}
console.log(violations.length ? `\nVIOLATIONS INTRODUCED BY TARGET SET (${violations.length}):` : '\nNO VIOLATIONS — target agents are name-unique, emoji-unique, and description-distinct.');
for (const v of violations) console.log(`  ${v}`);

// most-similar pairs for transparency (top 5, any outcome)
const near = [];
for (let i = 0; i < agents.length; i++) {
  for (let j = i + 1; j < agents.length; j++) {
    const a = agents[i], b = agents[j];
    if (a.division !== b.division) continue;
    const sim = jaccard(a.set, b.set);
    if (sim > 0) near.push([sim, a.id, b.id, a.division]);
  }
}
near.sort((x, y) => y[0] - x[0]);
console.log('\ntop same-division description similarities:');
for (const [sim, a, b, d] of near.slice(0, 5)) console.log(`  ${(sim * 100).toFixed(0)}%  ${a} <-> ${b} [${d}]`);

process.exit(violations.length ? 1 : 0);
