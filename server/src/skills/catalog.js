/**
 * JEXI OS — SKILLS — catalog.
 *
 * Startup-time metadata index for progressive disclosure. Reads ONLY the
 * YAML frontmatter (name, description, whenToUse, allowedTools) of every
 * SKILL.md under the skills store — the full body is deliberately NOT read
 * into memory. The catalog is what the planner sees (~50-100 tokens/entry);
 * the loader pulls the full body on demand.
 *
 *   const { catalog, catalogEntry } = await import('./skills/catalog.js');
 *   const index = await catalog();          // { slug: meta }
 *   const meta = await catalogEntry('debugging'); // single entry (or null)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Overridable store root (repo pattern: process.env.DATA_DIR). */
export const SKILLS_STORE = path.resolve(process.env.JEXI_SKILLS_STORE || path.join(__dirname, 'skills'));

/** Parse just the YAML frontmatter block of a SKILL.md (no body read). */
export function parseFrontmatter(md) {
  if (!md.startsWith('---\n')) return { metadata: {}, bodyMarkdown: md };
  const end = md.indexOf('\n---\n', 4);
  if (end === -1) return { metadata: {}, bodyMarkdown: md };
  const fm = md.slice(4, end);
  const bodyMarkdown = md.slice(end + 5);
  const metadata = {};
  for (const line of fm.split('\n')) {
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim();
    // YAML arrays like `allowedTools: [a, b]` → JS array.
    if (value.startsWith('[') && value.endsWith(']')) {
      metadata[key] = value.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      metadata[key] = value.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    }
  }
  return { metadata, bodyMarkdown };
}

/** Deterministic slug from a skill name. */
export function slugify(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Read the SKILL.md file for a slug, returning ONLY frontmatter meta.
 * Returns null for a missing skill — never throws for missing dirs.
 */
export function readMeta(slug) {
  const dir = path.join(SKILLS_STORE, slug);
  const mdPath = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(mdPath)) return null;
  const { metadata } = parseFrontmatter(fs.readFileSync(mdPath, 'utf8'));
  return metadata;
}

/** Full catalog index (metadata only, keyed by slug). Loads each frontmatter only. */
export async function catalog() {
  let entries;
  try {
    entries = fs.readdirSync(SKILLS_STORE, { withFileTypes: true });
  } catch {
    return {};
  }
  const out = {};
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const meta = readMeta(ent.name);
    if (!meta) continue;
    out[ent.name] = {
      slug: ent.name,
      name: meta.name ?? ent.name,
      description: meta.description ?? '',
      whenToUse: meta.whenToUse ?? '',
      allowedTools: meta.allowedTools ?? [],
    };
  }
  return out;
}

export async function catalogEntry(slug) {
  const meta = readMeta(slug);
  if (!meta) return null;
  return {
    slug,
    name: meta.name ?? slug,
    description: meta.description ?? '',
    whenToUse: meta.whenToUse ?? '',
    allowedTools: meta.allowedTools ?? [],
  };
}

/** Compact system-prompt-ready summary: one line per skill. */
export async function catalogSystemPrompt() {
  const index = await catalog();
  return Object.values(index)
    .map((s) => `- ${s.slug}: ${s.description}`)
    .join('\n');
}