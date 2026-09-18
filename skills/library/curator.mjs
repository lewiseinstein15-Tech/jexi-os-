#!/usr/bin/env node
/**
 * JEXI OS — LIBRARY CURATOR (Phase 12 Scope F).
 *
 * The dedupe gate for skills/library/: a staged skill is IMPORTED only if
 * its description stays below OVERLAP_THRESHOLD 0.85 cosine similarity
 * against (a) every existing JEXI skill (skills/engineering, skills/design)
 * and (b) every already-accepted library skill. At/above the threshold the
 * import is SKIPPED as a duplicate and recorded in IMPORT-MANIFEST.json.
 *
 * Similarity: token-vector cosine from skills/aas/compose-stack.js (same
 * function the AAS selection layer enforces).
 *
 * CLI:
 *   node curator.mjs --stage /tmp/stage --repo /path/to/repo
 *
 * Staging layout:  <stage>/matt/<slug>/SKILL.md          → library/engineering/<slug>/
 *                  <stage>/aas/<cat>/<slug>/SKILL.md     → library/aas/<cat>/<slug>/
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cosineSimilarity, OVERLAP_THRESHOLD } from '../aas/compose-stack.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const get = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const STAGE = get('--stage', '/tmp/p12/stage');
const REPO = get('--repo', path.resolve(HERE, '..', '..'));
const LIBRARY = path.join(REPO, 'skills', 'library');

function* walkSkillMd(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walkSkillMd(p);
    else if (ent.name === 'SKILL.md') yield p;
  }
}

function frontmatter(raw) {
  if (!raw.startsWith('---\n')) return {};
  const end = raw.indexOf('\n---\n', 4);
  if (end === -1) return {};
  const meta = {};
  for (const line of raw.slice(4, end).split('\n')) {
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (m) meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return meta;
}

function descOf(raw) {
  const meta = frontmatter(raw);
  return String(meta.description || '');
}

// ---- baseline: existing JEXI skills (everything under skills/ EXCEPT library) ----
const baseline = [];
const skillsRoot = path.join(REPO, 'skills');
for (const f of walkSkillMd(skillsRoot)) {
  if (f.startsWith(LIBRARY)) continue;
  const raw = fs.readFileSync(f, 'utf8');
  baseline.push({ id: frontmatter(raw).name || path.basename(path.dirname(f)), description: descOf(raw), path: path.relative(REPO, f) });
}

// ---- staged candidates ----
const candidates = [];
for (const group of ['matt', 'aas']) {
  const groupDir = path.join(STAGE, group);
  if (!fs.existsSync(groupDir)) continue;
  for (const f of walkSkillMd(groupDir)) {
    const rel = path.relative(groupDir, f);
    const raw = fs.readFileSync(f, 'utf8');
    candidates.push({
      group,
      relFrom: f,
      relTo: path.join(LIBRARY, group === 'matt' ? 'engineering' : path.join('aas', path.dirname(rel)), path.basename(path.dirname(f))),
      id: frontmatter(raw).name || path.basename(path.dirname(f)),
      description: descOf(raw),
      bytes: sizeOf(f),
    });
  }
}
function sizeOf(file) {
  const dir = path.dirname(file);
  let n = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else n += fs.statSync(p).size; } };
  walk(dir);
  return n;
}

// ---- the gate ----
const acceptedVectors = baseline.map((b) => ({ id: b.id, description: b.description, kind: 'existing' }));
const imported = []; const skipped = []; let mergedCount = 0;
for (const cand of candidates) {
  let worst = { sim: 0, vs: null };
  for (const v of acceptedVectors) {
    const sim = cosineSimilarity(cand.description, v.description);
    if (sim > worst.sim) worst = { sim, vs: v };
  }
  // exact id collision with an existing skill is a duplicate by definition
  const idClash = acceptedVectors.some((v) => v.kind === 'existing' && v.id.toLowerCase() === cand.id.toLowerCase());
  if (idClash || worst.sim >= OVERLAP_THRESHOLD) {
    skipped.push({
      id: cand.id,
      vs: idClash ? `existing id '${cand.id}'` : worst.vs.id,
      similarity: idClash ? 1 : Math.round(worst.sim * 1000) / 1000,
      threshold: OVERLAP_THRESHOLD,
      reason: idClash ? 'duplicate id of an existing JEXI skill' : `description ${Math.round(worst.sim * 100)}% similar to '${worst.vs.id}'`,
      sourceGroup: cand.group,
    });
    continue;
  }
  acceptedVectors.push({ id: cand.id, description: cand.description, kind: 'library' });
  fs.mkdirSync(path.dirname(cand.relTo), { recursive: true });
  fs.cpSync(path.dirname(cand.relFrom), cand.relTo, { recursive: true });
  imported.push({ id: cand.id, to: path.relative(REPO, cand.relTo), sourceGroup: cand.group, bytes: cand.bytes });
  if (cand.group === 'matt') mergedCount += 0; // merges counted below
}

// "merged" = near-duplicates (0.60 <= sim < 0.85) recorded as merge candidates for later curation
const mergeCandidates = [];
for (const s of skipped) if (s.similarity >= 0.60 && !s.reason.includes('duplicate id')) mergeCandidates.push(s);

const manifest = {
  kind: 'jexi.library.import-manifest',
  version: 1,
  generatedAt: new Date().toISOString(),
  threshold: OVERLAP_THRESHOLD,
  baselineSize: baseline.length,
  staged: candidates.length,
  importedCount: imported.length,
  skippedCount: skipped.length,
  mergeCandidates,
  imported,
  skipped,
};
fs.writeFileSync(path.join(LIBRARY, 'IMPORT-MANIFEST.json'), JSON.stringify(manifest, null, 2));
const totalBytes = imported.reduce((n, i) => n + i.bytes, 0);
console.log(`CURATOR: staged=${candidates.length} imported=${imported.length} skipped=${skipped.length} (threshold=${OVERLAP_THRESHOLD})`);
console.log(`bytes imported: ${totalBytes}`);
console.log('skipped:', skipped.map((s) => `${s.id} → ${s.vs} @ ${s.similarity}`).join(' | ') || 'none');
