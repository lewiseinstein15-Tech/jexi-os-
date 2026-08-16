/**
 * JEXI OS — Filesystem-native coworker definitions (B78).
 *
 * Coworker roles/personas live as markdown files with YAML frontmatter under
 * <repo>/jexi-agents/ (the same pattern as skills: `.agents/` + SKILL.md,
 * per Google Antigravity Managed Agents):
 *
 *   jexi-agents/
 *     ORCHESTRATOR.md          ← orchestrator core rules, routing, truthfulness
 *     coworkers/
 *       coding.md              ← coder mandate (DeepSeek/Qwen fallback)
 *       memory.md              ← memory mandate (Qwen+Gemini pairing)
 *       research.md            ← research mandate (Grok + fallbacks)
 *       email.md               ← email mandate (creator recognition, tone)
 *       github.md              ← github mandate (file operations allowed)
 *
 * The orchestrator LOADS the relevant coworker file at the point where it
 * routes a task to that coworker — the mandates are not baked into one giant
 * composite prompt. Editing one file changes only that coworker's behavior.
 *
 * Deliberately simple: no plugin system, no caching — the files are read from
 * disk when the coworker is selected (they are a few KB), so a live edit is
 * picked up immediately. Override the directory with JEXI_AGENTS_DIR (used by
 * tests to prove edit-one-file isolation).
 */

import fs from 'fs';
import path from 'path';
import { SERVER_ROOT } from '../config.js';

export const AGENTS_DIR = process.env.JEXI_AGENTS_DIR || path.resolve(SERVER_ROOT, '..', 'jexi-agents');
export const COWORKERS_DIR = path.join(AGENTS_DIR, 'coworkers');

/** WorkerRouter role slug → coworker file name. */
export const COWORKER_FILES = {
  coder: 'coding.md',
  memory: 'memory.md',
  researcher: 'research.md',
  email: 'email.md',
  github: 'github.md',
};

/** Split YAML frontmatter (`---\n…\n---\nbody`) from the markdown body. */
export function parseFrontmatter(content) {
  const text = String(content || '');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    // Strip quotes
    const clean = value.replace(/^['"]|['"]$/g, '').trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else if (value === 'true' || value === 'false') {
      meta[key] = value === 'true';
    } else {
      meta[key] = clean;
    }
  }
  return { meta, body: m[2].trim() };
}

/** Path to a coworker's markdown file (or null for unknown slugs). */
export function coworkerFilePath(slug) {
  const file = COWORKER_FILES[slug];
  if (!file) return null;
  return path.join(COWORKERS_DIR, file);
}

/**
 * Load one coworker's definition from disk. Returns
 *   { slug, file, meta, body, content }
 * or null when the slug is unknown or the file is missing. Read fresh on
 * every call — an edit to one file is picked up immediately and never leaks
 * into any other coworker.
 */
export function loadCoworker(slug) {
  const file = COWORKER_FILES[slug];
  if (!file) return null;
  const p = path.join(COWORKERS_DIR, file);
  if (!fs.existsSync(p)) return null;
  try {
    const content = fs.readFileSync(p, 'utf-8');
    const { meta, body } = parseFrontmatter(content);
    return { slug, file, meta, body, content };
  } catch (e) {
    return null;
  }
}

/** Load the orchestrator's core rules (ORCHESTRATOR.md). */
export function loadOrchestrator() {
  const p = path.join(AGENTS_DIR, 'ORCHESTRATOR.md');
  if (!fs.existsSync(p)) return null;
  try {
    const content = fs.readFileSync(p, 'utf-8');
    const { meta, body } = parseFrontmatter(content);
    return { file: 'ORCHESTRATOR.md', meta, body, content };
  } catch (e) {
    return null;
  }
}

/**
 * The orchestrator-rules fragment appended to the system prompt of every
 * coworker run (SIMPLE path + graph nodes). Empty string when the file is
 * missing — the system prompt is never worse for it.
 */
export function orchestratorPromptFragment() {
  const o = loadOrchestrator();
  if (!o || !o.body) return '';
  return `\n\nORCHESTRATOR RULES (always binding):\n${o.body.slice(0, 3000)}`;
}

/** List every coworker that has a definition file (for status/debug). */
export function listCoworkers() {
  const out = [];
  for (const [slug, file] of Object.entries(COWORKER_FILES)) {
    const p = path.join(COWORKERS_DIR, file);
    if (!fs.existsSync(p)) continue;
    const def = loadCoworker(slug);
    if (def) out.push({ slug, file, meta: def.meta, present: true });
  }
  return out;
}
