/**
 * JEXI OS — Knowledge Base (B50 P2).
 *
 * The always-on project knowledge file (server/knowledge/JEXI.md) is injected
 * into every session at low token cost, plus progressive knowledge folders
 * (server/knowledge/<category>/) that load ONLY when the knowledge-load tool
 * is called — Claude Code's CLAUDE.md pattern made data-driven.
 *
 * Open-source lineage: Anthropic's CLAUDE.md convention (a permanent, cheap,
 * project-scoped context file agents read on every run) + progressive
 * disclosure (only the pointer is always-on; the detail loads on demand).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const KNOWLEDGE_DIR = path.resolve(__dirname, '../../knowledge');

let _cache = null;

/** Read server/knowledge/JEXI.md (cached) — the always-on project knowledge. */
export function loadProjectKnowledge() {
  if (_cache !== null) return _cache;
  try {
    const p = path.join(KNOWLEDGE_DIR, 'JEXI.md');
    _cache = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  } catch {
    _cache = '';
  }
  return _cache;
}

/** List the progressive knowledge categories available (folder names). */
export function listKnowledgeCategories() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) return [];
  return fs.readdirSync(KNOWLEDGE_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => !n.startsWith('.'))
    .sort();
}

/**
 * Load a progressive knowledge folder by name (e.g. 'conventions',
 * 'architecture'). Accepts KNOWLEDGE.md, knowledge.md, or a single .md file
 * inside the folder. Returns null for unknown folders — never throws.
 * NOT injected by default: only called via the knowledge-load tool.
 */
export function knowledgeLoad(category) {
  if (!category) return null;
  const safe = String(category).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return null;
  const dir = path.join(KNOWLEDGE_DIR, safe);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  for (const name of ['KNOWLEDGE.md', 'knowledge.md']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return { category: safe, file: name, md: fs.readFileSync(p, 'utf-8') };
  }
  const md = fs.readdirSync(dir).find((f) => f.endsWith('.md'));
  if (md) return { category: safe, file: md, md: fs.readFileSync(path.join(dir, md), 'utf-8') };
  return null;
}

/** One-line status for /api/settings and health surfaces. */
export function knowledgeStatus() {
  return {
    alwaysOn: (loadProjectKnowledge() || '').length,
    categories: listKnowledgeCategories(),
  };
}
