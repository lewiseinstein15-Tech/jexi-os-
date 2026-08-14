/**
 * JEXI OS — Agent Definitions (B50 P4).
 *
 * Reusable, on-disk agent definition files under server/agents/ — the
 * "reusable agents" primitive: a definition file (frontmatter: name,
 * description, model preference, allowed tools; body: the specialist system
 * prompt) that any runtime can load and spawn. A definition can declare
 * `context: fork`, meaning it runs isolated and returns only a summary.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AGENTS_DIR = path.resolve(__dirname, '../../agents');

/** Parse YAML frontmatter (---\nkey: value\n---) from an agent definition. */
export function parseAgentFrontmatter(md) {
  const m = String(md || '').match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return {};
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z-]+):\s*(.*)$/);
    if (!kv) continue;
    const val = kv[2].trim();
    meta[kv[1]] = val.startsWith('[')
      ? val.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean)
      : val;
  }
  return meta;
}

/** List available agent definition slugs (server/agents/*.md). */
export function listAgentDefinitions() {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  return fs.readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

/** Load an agent definition by slug → { slug, meta, systemPrompt }. Null if absent. */
export function loadAgentDefinition(slug) {
  const safe = String(slug || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return null;
  const p = path.join(AGENTS_DIR, `${safe}.md`);
  if (!fs.existsSync(p)) return null;
  const md = fs.readFileSync(p, 'utf-8');
  const meta = parseAgentFrontmatter(md);
  const systemPrompt = String(md).replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim();
  return { slug: safe, meta, systemPrompt };
}

/** Does a definition (or skill frontmatter) declare isolated execution? */
export function wantsIsolation(def) {
  return !!(def && def.meta && String(def.meta.context || '').toLowerCase() === 'fork');
}

/** Resolve the allowed-tools list from a definition, else []. */
export function allowedToolsFor(def) {
  return (def && def.meta && def.meta['allowed-tools']) || [];
}
