/**
 * B100 — SPILL STORE (mirror of DeepSeek Harness `packages/spill/spill-local`
 * + `packages/spill/spill`): persist a tool's oversized output to a private
 * session-scoped file and return a model-facing locator + retrieval guidance
 * instead of stuffing the whole text into context.
 *
 *  - saveText({ owner, source, suggestedName, content }) → { locator, bytes, retrievalHint }
 *  - readSpill(locator) — path-safe read for the model-facing `spill-read` tool
 *  - listSpills(owner) — metadata for inspection
 *
 * The spill policy lives in ToolRuntime: results over SPILL_THRESHOLD chars
 * are spilled automatically; the model gets a bounded preview + locator and
 * can pull the full body with `spill-read` when it actually needs it.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

const SPILLS_DIR = path.join(DATA_DIR, 'spills');

/** Results longer than this (characters) are spilled instead of returned whole. */
export const SPILL_THRESHOLD = 14000;
/** Preview length kept in the model-facing result. */
export const SPILL_PREVIEW_CHARS = 2000;
/** Full-body cap for spill-read (the model rarely needs the entire dump). */
export const SPILL_READ_CAP = 30000;

function ownerDir(owner) {
  const safe = String(owner || 'agent').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60);
  return path.join(SPILLS_DIR, safe);
}

function fileName(suggestedName, ts) {
  const base = String(suggestedName || 'output').replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.{2,}/g, '.').slice(0, 60) || 'output';
  return `${base}-${ts}.txt`;
}

function ensureDir() { try { fs.mkdirSync(SPILLS_DIR, { recursive: true }); } catch { /* noop */ } }

/**
 * Persist text verbatim, namespaced by the owning session.
 * @returns {{ ok: true, locator, bytes, retrievalHint } | { ok: false, error }}
 */
export function saveText({ owner, source, suggestedName, content }) {
  const text = String(content || '');
  if (!text) return { ok: false, error: 'nothing to spill' };
  try {
    ensureDir();
    const dir = ownerDir(owner);
    fs.mkdirSync(dir, { recursive: true });
    const ts = Date.now();
    const file = path.join(dir, fileName(suggestedName, ts));
    fs.writeFileSync(file, text, 'utf-8');
    const locator = `spill://${String(owner || 'agent').replace(/[^A-Za-z0-9._-]/g, '_')}/${path.basename(file)}`;
    return {
      ok: true,
      locator,
      bytes: Buffer.byteLength(text, 'utf8'),
      retrievalHint: `read the spilled file with the spill-read tool: spill-read({ locator: "${locator}" })`,
    };
  } catch (e) {
    return { ok: false, error: `spill write failed: ${(e && e.message) || e}` };
  }
}

/** Resolve a locator to an absolute path, refusing anything outside the spills dir. */
function resolveLocator(locator) {
  const raw = String(locator || '');
  const m = raw.match(/^spill:\/\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+\.txt)$/);
  if (!m) return null;
  const abs = path.resolve(path.join(SPILLS_DIR, m[1], m[2]));
  const root = path.resolve(SPILLS_DIR);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

/** Read a spilled file by locator (path-safe). */
export function readSpill(locator, cap = SPILL_READ_CAP) {
  const abs = resolveLocator(locator);
  if (!abs) return { ok: false, error: 'invalid or unsafe spill locator' };
  try {
    if (!fs.existsSync(abs)) return { ok: false, error: 'spilled file not found (may have been cleaned up)' };
    const text = fs.readFileSync(abs, 'utf-8');
    return { ok: true, locator, bytes: Buffer.byteLength(text, 'utf8'), content: text.slice(0, cap) };
  } catch (e) {
    return { ok: false, error: `spill read failed: ${(e && e.message) || e}` };
  }
}

/** Metadata listing for an owner (never the bodies). */
export function listSpills(owner) {
  const dir = ownerDir(owner);
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.txt'))
      .sort((a, b) => b.localeCompare(a))
      .map((f) => {
        let bytes = 0;
        try { bytes = fs.statSync(path.join(dir, f)).size; } catch { /* noop */ }
        return { file: f, bytes, locator: `spill://${String(owner || 'agent').replace(/[^A-Za-z0-9._-]/g, '_')}/${f}` };
      });
  } catch { return []; }
}

/** Total spilled bytes for an owner (used by status endpoints). */
export function spillStats(owner) {
  const items = listSpills(owner);
  return { count: items.length, bytes: items.reduce((a, b) => a + b.bytes, 0) };
}
