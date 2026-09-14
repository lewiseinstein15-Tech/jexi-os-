/**
 * JEXI OS — SKILLS — loader.
 *
 * On-demand full-skill loading. `read_skill(slug)` returns the complete
 * SKILL.md body PLUS paths to scripts/ and resources/ for that skill —
 * but ONLY when called. The loader never returns content for a
 * non-existent skill (returns null).
 *
 * Progressive disclosure:
 *   catalog  → frontmatter only (startup, ~50-100 tokens/entry)
 *   loader   → full body on demand (execution time)
 */
import fs from 'node:fs';
import path from 'node:path';
import { SKILLS_STORE, parseFrontmatter, parseSteps } from './catalog.js';

function listHelpers(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort();
}

/** Full skill content for a slug, or null. */
export function readSkill(slug) {
  const dir = path.join(SKILLS_STORE, slug);
  const mdPath = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(mdPath)) return null;
  const raw = fs.readFileSync(mdPath, 'utf8');
  const { metadata, bodyMarkdown } = parseFrontmatter(raw);
  const scriptsDir = path.join(dir, 'scripts');
  const resourcesDir = path.join(dir, 'resources');
  const steps = parseSteps(bodyMarkdown);
  return {
    slug,
    name: metadata.name ?? slug,
    description: metadata.description ?? '',
    whenToUse: metadata.whenToUse ?? '',
    allowedTools: metadata.allowedTools ?? [],
    /** Full markdown WITHOUT the frontmatter — this is the big body. */
    content: bodyMarkdown,
    raw,
    /** Machine-executable procedure (parsed from `## Steps`): each step names
     *  a real registry tool + args. Empty when the skill is prose-only. */
    steps,
    executable: steps.some((s) => s.tool),
    scripts: listHelpers(scriptsDir).map((f) => path.join(scriptsDir, f)),
    resources: listHelpers(resourcesDir).map((f) => path.join(resourcesDir, f)),
    progressive: true, // loaded on demand
  };
}

/** Async wrapper matching the `read_skill` tool contract. */
export async function readSkillAsync(slug) {
  return readSkill(slug);
}