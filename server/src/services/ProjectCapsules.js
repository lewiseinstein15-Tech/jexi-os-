/**
 * B128 — PROJECT CAPSULES (DeepSeek Harness memory-continuation mirror).
 *
 * DSH continues projects because its append-only session log + workspace
 * state persist everything: a new session can resume a past one (fork),
 * search it (session-query), and read the project's instructions from the
 * workspace. JEXI now gets the equivalent for BUILDS: after any
 * autonomous build, a durable "project capsule" is written —
 * { name, files, summary, previewUrl, lastQuery, updatedAt } — so ANY
 * conversation can continue the project by name ("continue the todo app",
 * "go back to the calculator", "add dark mode to my app"). The capsule is
 * injected into the query on continuation, and listed in the UI.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { sanitizeModelOutput } from './ToolRuntime.js';
import { PUBLIC_URL, MANAGER_URL } from '../config.js';

const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const MAX_CAPSULES = 40;

function fileFor(name) {
  const safe = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
  return path.join(PROJECTS_DIR, `${safe}.json`);
}

function ensureDir() { try { fs.mkdirSync(PROJECTS_DIR, { recursive: true }); } catch { /* noop */ } }

/** Normalize a project name from user speech → stable slug + display name. */
export function normalizeProjectName(text) {
  const cleaned = String(text || '')
    .replace(/^(please\s+)?(continue|keep going|go back to|update|upgrade|modify|change|add to|finish|resume|build|make|create|improve|fix|extend|work on)\s+(the|my|on|with)?\s*/i, '')
    .replace(/[?.!]+$/g, '')
    .trim();
  if (!cleaned) return null;
  const slug = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return slug ? { slug, display: cleaned.slice(0, 80) } : null;
}

/** Save (or update) a project capsule after a build. */
export function saveProjectCapsule({ name, files = [], summary = '', previewUrl = null, lastQuery = '', meta = {} }) {
  const norm = normalizeProjectName(name || lastQuery);
  if (!norm) return null;
  ensureDir();
  const fp = fileFor(norm.slug);
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { /* new */ }
  const capsule = {
    slug: norm.slug,
    name: norm.display,
    files: Array.isArray(files) && files.length ? files : (prev.files || []),
    summary: String(summary || prev.summary || '').slice(0, 4000),
    previewUrl: previewUrl || prev.previewUrl || null,
    lastQuery: String(lastQuery || prev.lastQuery || '').slice(0, 500),
    updatedAt: Date.now(),
    createdAt: prev.createdAt || Date.now(),
    ...meta,
  };
  try {
    fs.writeFileSync(fp, JSON.stringify(capsule, null, 2), 'utf-8');
    // Cap the store (oldest first).
    const all = listProjectCapsules();
    for (const c of all.slice(MAX_CAPSULES)) {
      try { fs.unlinkSync(fileFor(c.slug)); } catch { /* noop */ }
    }
  } catch { /* noop */ }
  return capsule;
}

/** Find a capsule by slug (or fuzzy: substring match on name). */
export function findProjectCapsule(query) {
  const norm = normalizeProjectName(query);
  if (!norm) return null;
  const direct = fileFor(norm.slug);
  try { if (fs.existsSync(direct)) return JSON.parse(fs.readFileSync(direct, 'utf-8')); } catch { /* noop */ }
  // fuzzy: any capsule whose name contains the slug words or vice versa
  const all = listProjectCapsules();
  const q = norm.slug.replace(/-/g, ' ');
  return all.find((c) => {
    const n = `${c.name} ${c.slug}`.toLowerCase();
    return q.split(/\s+/).filter((w) => w.length > 2).some((w) => n.includes(w));
  }) || null;
}

/** All capsules, newest first. */
export function listProjectCapsules() {
  try {
    if (!fs.existsSync(PROJECTS_DIR)) return [];
    return fs.readdirSync(PROJECTS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try { return JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf-8')); } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch { return []; }
}

/** Render a capsule as injected context for a continuation query. */
export function capsuleContext(query) {
  const capsule = findProjectCapsule(query);
  if (!capsule) return null;
  const lines = [
    `[Project capsule "${capsule.name}" (last active ${new Date(capsule.updatedAt).toISOString().slice(0, 16)} UTC):`,
    `Files: ${(capsule.files || []).slice(0, 25).map((f) => (typeof f === 'string' ? f : f.path || f.name)).join(', ')}`,
  ];
  if (capsule.summary) lines.push(`Last summary: ${String(capsule.summary).slice(0, 1200)}`);
  if (capsule.previewUrl) lines.push(`Preview: ${capsule.previewUrl}`);
  lines.push('Continue THIS project — read the files first, then make the requested change.]');
  return '\n' + lines.join('\n') + '\n';
}

/** The tappable preview base (public URL on Render). */
export function previewBase() {
  return (PUBLIC_URL || MANAGER_URL || '').replace(/\/+$/, '');
}

export { sanitizeModelOutput };
