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

/**
 * Parse the machine-executable `## Steps` procedure block from a SKILL.md
 * body. Each line is one step:
 *
 *   - step: <human description>
 *     tool: <registry tool slug>
 *     args: { "<arg>": <value or $prev.<path> template> }
 *
 * The `args` must be a JSON object (the step names a REAL tool from the
 * registry and passes REAL args). Free-form prose is ignored — a step
 * without a `tool:` line is not executable.
 */
export function parseSteps(bodyMarkdown) {
  const m = String(bodyMarkdown || '').match(/##\s*Steps\s*\n([\s\S]*?)(?=\n##\s|\s*$)/i);
  if (!m) return [];
  const steps = [];
  let cur = null;
  for (const rawLine of m[1].split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('- step:')) {
      if (cur) steps.push(cur);
      cur = { step: line.replace(/^- step:\s*/, '').replace(/["']$/, '').trim() };
    } else if (cur) {
      const tool = /^tool:\s*([A-Za-z0-9_:.-]+)/.exec(line);
      if (tool) { cur.tool = tool[1]; continue; }
      const args = /^args:\s*(\{.*\})\s*$/.exec(line);
      if (args) {
        try { cur.args = JSON.parse(args[1]); } catch { cur.argsParseError = `invalid JSON: ${args[1]}`; }
        continue;
      }
      // continuation of a multi-line args object
      if (cur.argsText) { cur.argsText += '\n' + line; continue; }
      if (cur.tool && !cur.args && line.startsWith('{')) { cur.argsText = line; continue; }
    }
  }
  if (cur) steps.push(cur);
  // Merge multi-line argsText JSON into args.
  for (const s of steps) {
    if (!s.args && s.argsText) {
      try { s.args = JSON.parse(s.argsText); } catch { s.argsParseError = `invalid JSON: ${s.argsText}`; }
    }
    delete s.argsText;
  }
  return steps;
}

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
  const raw = fs.readFileSync(mdPath, 'utf8');
  const { metadata, bodyMarkdown } = parseFrontmatter(raw);
  // The catalog advertises executability WITHOUT leaking the body: only the
  // count of parseable steps (frontmatter + a cheap step scan) is exposed.
  metadata._stepCount = parseSteps(bodyMarkdown).filter((s) => s.tool).length;
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
      executable: meta._stepCount > 0,
      stepCount: meta._stepCount ?? 0,
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
    executable: meta._stepCount > 0,
    stepCount: meta._stepCount ?? 0,
  };
}

/** Compact system-prompt-ready summary: one line per skill. */
export async function catalogSystemPrompt() {
  const index = await catalog();
  return Object.values(index)
    .map((s) => `- ${s.slug}: ${s.description}`)
    .join('\n');
}