/**
 * JEXI OS — UNIVERSAL SKILL INSTALLER — convert.js
 *
 * Discovers skills under a source tree (default skills/library/) and
 * reshapes them per target style:
 *   skill-dir → {slug}/SKILL.md (+ references/, scripts/ when present)
 *   flat-md   → {slug}.md — front-matter flattened into a markdown header
 *
 * Every output file carries a provenance line. Pure functions: no I/O.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

export function parseFrontmatter(raw) {
  if (!raw.startsWith('---\n')) return { meta: {}, body: String(raw) };
  const end = raw.indexOf('\n---\n', 4);
  if (end === -1) return { meta: {}, body: String(raw) };
  const meta = {};
  for (const line of raw.slice(4, end).split('\n')) {
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (m) meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: raw.slice(end + 5).replace(/^\s*\n/, '') };
}

/** Discover every skill (a dir containing SKILL.md) under sourceDir. */
export function discoverSkills(sourceDir) {
  const skills = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.name === 'SKILL.md')) {
      const raw = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const slug = String(meta.name || path.basename(dir)).trim();
      if (slug) skills.push({ slug, meta, body, raw, dir });
      return; // a skill dir is a leaf — do not index nested skills inside it
    }
    for (const e of entries) if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')) walk(path.join(dir, e.name));
  };
  walk(sourceDir);
  skills.sort((a, b) => a.slug.localeCompare(b.slug));
  // dedupe by slug (first wins; library is curator-deduped already)
  const seen = new Set();
  return skills.filter((s) => (seen.has(s.slug) ? false : (seen.add(s.slug), true)));
}

/** Flatten a skill to a single markdown doc (for flat-md harnesses). */
export function toFlatMarkdown(skill) {
  const m = skill.meta;
  const head = [
    `# ${m.name || skill.slug}`,
    '',
    `> JEXI skill \`${skill.slug}\`${m.version ? ` v${m.version}` : ''} — installed by the JEXI universal installer.`,
    m.description ? `> **Description:** ${m.description}` : null,
    m.whenToUse ? `> **When to use:** ${m.whenToUse}` : null,
    m.origin ? `> **Origin:** ${m.origin}` : null,
    '',
    '<!--- flattened from SKILL.md by skills/installer — do not edit by hand; reinstall to update -->',
    '',
  ].filter((x) => x !== null);
  return head.join('\n') + skill.body.replace(/\s*$/, '\n');
}

/** File plan for one skill + target style. Returns [{relPath, content}] */
export function planFiles(skill, style) {
  const out = [];
  if (style === 'skill-dir') {
    out.push({ relPath: `${skill.slug}/SKILL.md`, content: skill.raw });
    for (const sub of ['references', 'scripts']) {
      const dir = path.join(skill.dir, sub);
      if (!fs.existsSync(dir)) continue;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isFile()) out.push({ relPath: `${skill.slug}/${sub}/${e.name}`, content: fs.readFileSync(path.join(dir, e.name), 'utf8') });
      }
    }
  } else {
    out.push({ relPath: `${skill.slug}.md`, content: toFlatMarkdown(skill) });
  }
  return out;
}
