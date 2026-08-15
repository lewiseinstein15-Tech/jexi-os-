/**
 * JEXI OS — Knowledge Files (B50 P2).
 *
 * Claude Code's CLAUDE.md pattern, made progressive:
 *   - server/knowledge/JEXI.md            — SHORT, always-on project knowledge,
 *                                           injected into every session prompt.
 *   - server/knowledge/<category>/<file>.md — progressive folders loaded ONLY
 *                                           when the `knowledge_load` tool is
 *                                           called with that category.
 *
 * The always-on file stays small; details live in the folders. This module is
 * the single loader used by JexiPrompt (injection) and ToolRuntime
 * (knowledge_load tool) so both can never disagree.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const KNOWLEDGE_DIR = path.resolve(__dirname, '../../knowledge');

/** The always-on project knowledge file. Missing file → short fallback (never crash). */
export function loadAlwaysOnKnowledge() {
  try {
    const p = path.join(KNOWLEDGE_DIR, 'JEXI.md');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '# JEXI OS project knowledge\n(no JEXI.md on disk — create server/knowledge/JEXI.md)';
  } catch (e) {
    return '# JEXI OS project knowledge\n(unavailable)';
  }
}

/** All progressive knowledge category names (folders directly under knowledge/). */
export function listKnowledgeCategories() {
  try {
    if (!fs.existsSync(KNOWLEDGE_DIR)) return [];
    return fs.readdirSync(KNOWLEDGE_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort();
  } catch { return []; }
}

/**
 * Load a progressive knowledge category: concatenates every .md file in
 * server/knowledge/<category>/ with headings, so `knowledge_load` returns one
 * readable block. Returns null for unknown categories.
 */
export function loadProgressiveKnowledge(category) {
  const cat = String(category || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cat) return null;
  const dir = path.join(KNOWLEDGE_DIR, cat);
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
    if (!files.length) return null;
    return files.map((f) => {
      const body = fs.readFileSync(path.join(dir, f), 'utf-8');
      return `---\n# ${f.replace(/\.md$/, '')}\n${body}`;
    }).join('\n\n');
  } catch (e) {
    return null;
  }
}

/** Convenience for the tool handler: { ok, content, category, files }. */
export function knowledgeLoad(category) {
  const content = loadProgressiveKnowledge(category);
  if (!content) return { ok: false, category, content: null, error: `Unknown knowledge category '${category}'. Available: ${listKnowledgeCategories().join(', ') || '(none)'}` };
  return { ok: true, category, content, files: fs.readdirSync(path.join(KNOWLEDGE_DIR, category)).filter((f) => f.endsWith('.md')) };
}
