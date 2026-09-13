/**
 * JEXI OS — SKILLS — curator.
 *
 * Second-pass lifecycle owner. The working agent drafts a skill; the CURATOR
 * (never the drafter alone) decides the library is correct. Responsibilities:
 *   - dedupe: overlapping skills are flagged (cosine similarity on
 *     description tokens above a threshold)
 *   - staleness: skills unused for N days move to `archived/`
 *   - overlap review: draft vs existing, returns a verdict
 *
 * All deterministic, no model calls — the "second pass" is a rules pass.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SKILLS_STORE, slugify, readMeta } from './catalog.js';

export const STALE_DAYS = 30;
export const DEDUPE_THRESHOLD = 0.75;

const ARCHIVE_DIR = 'archive';

/** Token-level cosine similarity between two descriptions. */
export function cosineSimilarity(a, b) {
  const ta = String(a ?? '').toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const tb = String(b ?? '').toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (!ta.length || !tb.length) return 0;
  const fa = new Map();
  const fb = new Map();
  for (const w of ta) fa.set(w, (fa.get(w) ?? 0) + 1);
  for (const w of tb) fb.set(w, (fb.get(w) ?? 0) + 1);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [w, c] of fa) { dot += c * (fb.get(w) ?? 0); na += c * c; }
  for (const [, c] of fb) nb += c * c;
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Read + track last-used from a small sidecar journal (deterministic). */
function usageJournalPath() {
  return path.join(SKILLS_STORE, '..', '.skill-usage.json');
}

export function recordSkillUsage(slug) {
  const f = usageJournalPath();
  let journal = {};
  try { journal = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* first use */ }
  journal[slug] = Date.now();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(journal, null, 2));
}

/**
 * Review a DRAFT skill against the existing library.
 * Returns a verdict: create | dedupe-reject | review-note.
 */
export function reviewDraft({ name, description, whenToUse: _whenToUse, allowedTools: _allowedTools = [], content: _content = '' }) {
  const slug = slugify(name);
  const existing = [];
  for (const ent of fs.readdirSync(SKILLS_STORE, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const meta = readMeta(ent.name);
    if (meta) existing.push({ slug: ent.name, ...meta });
  }
  const overlaps = existing
    .map((s) => ({ slug: s.slug, score: cosineSimilarity(description, s.description ?? '') }))
    .filter((s) => s.score >= DEDUPE_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  if (overlaps.length) {
    return { verdict: 'dedupe-reject', slug, reasons: overlaps.map((o) => `overlaps ${o.slug} (${o.score.toFixed(2)} >= ${DEDUPE_THRESHOLD})`), overlaps };
  }
  return { verdict: 'create', slug, reasons: ['no overlap above threshold'], overlaps: [] };
}

/** Archive any skill untouched for STALE_DAYS (based on the usage journal). */
export function archiveStaleSkill(slug, now = Date.now()) {
  const f = usageJournalPath();
  let journal = {};
  try { journal = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* none used */ }
  const lastUsed = journal[slug];
  if (lastUsed == null) return null; // never used (not yet tracked) → not stale
  const ageDays = (now - lastUsed) / 86_400_000;
  if (ageDays < STALE_DAYS) return null;
  const src = path.join(SKILLS_STORE, slug);
  const archiveRoot = path.join(SKILLS_STORE, ARCHIVE_DIR);
  const dst = path.join(archiveRoot, slug);
  if (!fs.existsSync(src)) return null;
  fs.mkdirSync(archiveRoot, { recursive: true });
  fs.renameSync(src, dst);
  return { slug, archivedAt: new Date().toISOString() };
}

/** Move an archived skill back into the live store. */
export function restoreSkill(slug) {
  const src = path.join(SKILLS_STORE, ARCHIVE_DIR, slug);
  const dst = path.join(SKILLS_STORE, slug);
  if (!fs.existsSync(src)) return false;
  fs.renameSync(src, dst);
  return true;
}

/** Full curation pass. Returns { reviewed, deduped, archived, notes }. */
export async function runCurator({ now = Date.now() } = {}) {
  const index = await fs.promises.readdir(SKILLS_STORE, { withFileTypes: true }).catch(() => []);
  const reviewed = [];
  const deduped = [];
  const archived = [];
  const dirs = index.filter((e) => e.isDirectory() && e.name !== ARCHIVE_DIR).map((e) => e.name);

  for (const slug of dirs) {
    const meta = readMeta(slug) ?? {};
    reviewed.push(slug);
    // dedupe: compare against every OTHER live skill
    for (const other of dirs) {
      if (other === slug) continue;
      const om = readMeta(other);
      if (!om) continue;
      const sim = cosineSimilarity(meta.description ?? '', om.description ?? '');
      if (sim >= DEDUPE_THRESHOLD) deduped.push({ a: slug, b: other, score: sim });
    }
    const staled = archiveStaleSkill(slug, now);
    if (staled) archived.push(staled);
  }
  return { reviewed, deduped, archived, notes: `dedupe threshold ${DEDUPE_THRESHOLD}, stale after ${STALE_DAYS}d` };
}