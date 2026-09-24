/**
 * JEXI OS — Phase 31 Scope 19 — brain/self/guard.js
 *
 * Immutable guard for the canonical self file. Layer 1 (`core.md`) is
 * edited by Lewis only; nothing running inside JEXI may write to it.
 *
 * This module is the ONE reader of core.md and the ONE place that refuses
 * writes. It parses the file into facts with their PROV-O attribution and
 * exposes `assertWritable(path)` so any write path that consults the
 * self-layer (Phase 31 bootstrap, probes, future tools) fails closed with
 * E_SELF_IMMUTABLE.
 *
 * Error class: SemanticaError (reused — one error class per layer).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SemanticaError } from '../../../services/semantica/_internal.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CORE_PATH = path.join(HERE, 'core.md');
export const VOICES_PATH = path.join(HERE, 'voices.md');

export const FACT_KEYS = Object.freeze([
  'name', 'formal_name', 'version', 'birthday', 'builder_primary', 'builder_secondary',
  'purpose', 'origin_summary', 'lewis_disclosure', 'no_source_code', 'no_self_replicate',
]);

const fail = (code, message, details = {}) => Object.assign(new SemanticaError(code, message), details);

const FACT_LINE = /^([a-z_]+):\s*(.*?)\s*\|\s*prov:\s*(.+?)\s*@\s*(\d{4}-\d{2}-\d{2}(?:T[0-9:.]+Z)?)\s*$/;

/** Parse core.md text -> { facts: {key: value}, prov: {key: {wasAttributedTo, generatedAtTime}}, sha256 }. */
export function parseCore(text) {
  const facts = {}; const prov = {};
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('Format:') || line.startsWith('Immutable')) continue;
    const m = FACT_LINE.exec(line);
    if (!m) continue;
    const [, key, value, who, when] = m;
    if (Object.hasOwn(facts, key)) throw fail('E_SELF_CORE_INVALID', `core.md: duplicate fact ${key}`);
    facts[key] = value;
    prov[key] = Object.freeze({ wasAttributedTo: who, generatedAtTime: when });
  }
  for (const k of FACT_KEYS) {
    if (!Object.hasOwn(facts, k)) throw fail('E_SELF_CORE_INVALID', `core.md: missing fact ${k}`);
    if (!prov[k]) throw fail('E_SELF_CORE_INVALID', `core.md: fact ${k} has no PROV-O line`);
  }
  return Object.freeze({
    facts: Object.freeze(facts),
    prov: Object.freeze(prov),
    sha256: crypto.createHash('sha256').update(String(text)).digest('hex'),
  });
}

/** Read + parse core.md from disk. Read-only. */
export function loadCore(corePath = CORE_PATH) {
  let text;
  try { text = fs.readFileSync(corePath, 'utf8'); }
  catch (e) { throw fail('E_SELF_CORE_UNAVAILABLE', `core.md unreadable: ${e.code ?? e.message}`); }
  return Object.freeze({ ...parseCore(text), path: corePath, bytes: Buffer.byteLength(text) });
}

/** True when `target` resolves to the protected self file. */
export function isProtectedPath(target) {
  if (typeof target !== 'string' || !target) return false;
  const abs = path.resolve(target);
  let real = abs;
  try { real = fs.realpathSync(abs); } catch { /* unresolved: compare lexical */ }
  let coreReal = CORE_PATH;
  try { coreReal = fs.realpathSync(CORE_PATH); } catch { /* keep lexical */ }
  return abs === CORE_PATH || real === coreReal || path.basename(abs) === 'core.md' && path.basename(path.dirname(abs)) === 'self' && path.basename(path.dirname(path.dirname(abs))) === 'brain';
}

/** Refuse any JEXI-side write to core.md. Throws E_SELF_IMMUTABLE. */
export function assertWritable(target, { actor = 'jexi' } = {}) {
  if (isProtectedPath(target)) {
    throw fail('E_SELF_IMMUTABLE', `brain/self/core.md is immutable from JEXI's side (actor ${actor}); only Lewis edits it`, { path: target, actor });
  }
  return true;
}

/** Guarded write: the only write helper the self-layer exposes. Always refuses core.md. */
export function guardedWrite(target, content, opts = {}) {
  assertWritable(target, opts);
  fs.writeFileSync(target, content);
  return { written: target, bytes: Buffer.byteLength(content) };
}

export const guard = Object.freeze({ CORE_PATH, VOICES_PATH, FACT_KEYS, parseCore, loadCore, isProtectedPath, assertWritable, guardedWrite });
export default guard;
