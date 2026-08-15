/**
 * B50 P1 — progressive-disclosure skills. Replaces SkillChain's flat loadSkill
 * with folder-first loading (SKILL.md + reference.md) + frontmatter metadata,
 * and deletes the four old flat skill files whose content moved into folders.
 * Fail-fast on anchor mismatch.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const p = path.join(root, 'src/services/SkillChain.js');
let s = fs.readFileSync(p, 'utf-8');

const oldBlock = `export function listSkillFiles() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.md')).sort();
}

/**
 * Load a skill's portable Markdown instructions by slug (e.g. 'qa',
 * 'security-officer'). The on-disk library is OPTIONAL: if the file is
 * missing, instructions are synthesized from the roster (agent profile +
 * mastered skills, or a plain skill-registry entry) so the sprint chain
 * NEVER reports "Skill not found" — every planner-selected skill loads.
 */
export function loadSkill(slug) {
  const file = listSkillFiles().find((f) => f.toLowerCase().includes(\`-\${resolveSkillSlug(slug)}.md\`));
  if (file) return { file, md: fs.readFileSync(path.join(SKILLS_DIR, file), 'utf-8') };
  const md = synthesizeSkill(slug);
  if (md) {
    // Persist the synthesized instructions so future boots read from disk.
    try {
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
      fs.writeFileSync(path.join(SKILLS_DIR, \`\${slug}.md\`), md, 'utf-8');
    } catch (e) { /* non-fatal */ }
    return { file: \`\${slug}.md\`, md };
  }
  return null;
}`;

if (!s.includes(oldBlock)) {
  console.error('ANCHOR MISSING in SkillChain.js');
  process.exit(1);
}

const newBlock = `/**
 * B50 P1 — YAML frontmatter parser (name, description, allowed-tools, context).
 */
export function parseFrontmatter(md) {
  const m = String(md || '').match(/^---\\s*\\n([\\s\\S]*?)\\n---\\s*\\n?/);
  if (!m) return {};
  const meta = {};
  for (const line of m[1].split('\\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    } else {
      val = val.replace(/^['"]|['"]$/g, '');
    }
    meta[key] = val;
  }
  return meta;
}

/** Skill slugs that have a progressive folder (SKILL.md present). */
export function listSkillDirs() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, d.name, 'SKILL.md')))
    .map((d) => d.name);
}

export function listSkillFiles() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.md')).sort();
}

/**
 * B50 P1 — PLANNING-TIME VIEW. Exposes ONLY name + description (+ allowed
 * tools + isolation flag) from SKILL.md frontmatter — cheap tokens. The full
 * body and reference.md load only when the skill actually executes
 * (loadSkill). This is what progressive disclosure is for.
 */
export function loadSkillMeta(slug) {
  const resolved = resolveSkillSlug(slug);
  const dir = path.join(SKILLS_DIR, resolved);
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) {
    const md = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
    const meta = parseFrontmatter(md);
    return {
      slug: resolved,
      name: meta.name || resolved,
      description: meta.description || '',
      allowedTools: Array.isArray(meta['allowed-tools']) ? meta['allowed-tools'] : [],
      context: meta.context || 'none',
      file: \`\${resolved}/SKILL.md\`,
    };
  }
  const file = listSkillFiles().find((f) => f.toLowerCase().includes(\`-\${resolved}.md\`));
  if (file) {
    const md = fs.readFileSync(path.join(SKILLS_DIR, file), 'utf-8');
    const meta = parseFrontmatter(md);
    return { slug: resolved, name: meta.name || resolved, description: meta.description || '', allowedTools: [], context: meta.context || 'none', file };
  }
  return null;
}

/** One-line description for planner / team-composition context. */
export function skillDescription(slug) {
  const meta = loadSkillMeta(slug);
  if (meta && meta.description) return \`\${slug}: \${meta.description}\`;
  const agent = getAgent(resolveSkillSlug(slug));
  return agent ? \`\${slug}: \${agent.role}\` : \`\${slug}: specialist expertise\`;
}

/**
 * Load a skill's portable Markdown instructions by slug (e.g. 'qa',
 * 'security-officer'). B50 P1 — PROGRESSIVE LOADING:
 *   1. folder  server/skills/<slug>/SKILL.md (+ reference.md)  ← preferred
 *   2. flat    server/skills/<slug>.md                          ← legacy
 *   3. roster  synthesized from the agent/skill registry        ← LOGGED fallback
 * The full SKILL.md body + reference.md load ONLY at execution time.
 */
export function loadSkill(slug) {
  const resolved = resolveSkillSlug(slug);
  const dir = path.join(SKILLS_DIR, resolved);
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) {
    const skillMd = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
    const refFile = path.join(dir, 'reference.md');
    const refMd = fs.existsSync(refFile) ? fs.readFileSync(refFile, 'utf-8') : '';
    const md = refMd
      ? \`\${skillMd}\\n\\n# REFERENCE (load when you need templates, checklists or examples)\\n\${refMd}\`
      : skillMd;
    return { file: \`\${resolved}/SKILL.md\`, md, reference: refMd, meta: loadSkillMeta(slug) };
  }
  const file = listSkillFiles().find((f) => f.toLowerCase().includes(\`-\${resolved}.md\`));
  if (file) return { file, md: fs.readFileSync(path.join(SKILLS_DIR, file), 'utf-8'), reference: '' };
  const md = synthesizeSkill(slug);
  if (md) {
    console.log(\`[SkillChain] \\u26a0 synthesized instructions for '\${slug}' (no folder or flat file on disk — roster fallback)\`);
    return { file: \`\${slug}.md\`, md, reference: '' };
  }
  return null;
}`;

s = s.split(oldBlock).join(newBlock);
fs.writeFileSync(p, s, 'utf-8');
console.log('[ok] SkillChain.js progressive loading');

// Remove the four old flat skill files whose content moved into folders.
for (const flat of ['product.md', 'engineer.md', 'reviewer.md', 'security-officer.md']) {
  const fp = path.join(root, 'skills', flat);
  if (fs.existsSync(fp)) {
    fs.unlinkSync(fp);
    console.log(`[ok] removed flat ${flat} (content lives in ${flat.replace('.md', '')}/)`);
  }
}
console.log('B50 P1 edits applied.');
