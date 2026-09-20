/**
 * JEXI OS — Phase 10 Scope I — CONTEXT OFFLOAD (file).
 *
 * Long contexts don't fit in the model window. Instead of truncating,
 * JEXI writes them to disk and lets agents reference them by name.
 * Same info, fewer tokens in context.
 *
 * Storage: .jexi/offload/<name>  (plain UTF-8 files, 0600)
 * Tokens:  Math.ceil(chars / 4)  — documented approximation, same convention
 *          as viking filesystem and MemoryProvider. NOT a BPE tokenizer;
 *          it estimates ~4 chars per token for English text. Use for budgeting,
 *          not for exact billing.
 *
 * Rules:
 * 1. Offloads live in .jexi/offload/
 * 2. write keeps content on disk until deleted
 * 3. Name collision → E_OFFLOAD_EXISTS unless opts.overwrite === true
 * 4. Path traversal → E_INVALID_NAME, names constrained to [a-zA-Z0-9_-]+
 * 5. read() missing → E_OFFLOAD_NOT_FOUND
 * 8. sha256 on read must match content hash
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const DEFAULT_OFFLOAD_DIR = path.resolve('.jexi/offload');
const NAME_RE = /^[A-Za-z0-9_-]+$/;
const MAX_NAME_LEN = 100;

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

export function validateName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > MAX_NAME_LEN) {
    throw fail('E_INVALID_NAME', `Invalid offload name: ${String(name).slice(0, 50)}`);
  }
  if (!NAME_RE.test(name)) {
    throw fail('E_INVALID_NAME', `Invalid offload name: ${name}`);
  }
  // Explicit traversal check even though regex already rejects / . \
  if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('.')) {
    // The dot check would reject '.' but regex already rejects '.'; keep for clarity
    // Only allow [a-zA-Z0-9_-], so '.' is already invalid. Still enforce.
    if (!NAME_RE.test(name)) throw fail('E_INVALID_NAME');
  }
  return true;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function offloadPath(dir, name) {
  validateName(name);
  return path.join(dir, name);
}

export function sha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function sizeBytes(content) {
  return Buffer.byteLength(content, 'utf8');
}

/**
 * Token approximation: ceil(chars/4)
 * Documented as approximation — NOT a real tokenizer.
 * Same convention as context/viking/filesystem.js and server/src/memory/interface/MemoryProvider.js
 */
export function estimateTokens(chars) {
  const n = typeof chars === 'string' ? chars.length : Number(chars) || 0;
  return Math.ceil(n / 4);
}

export function write(name, content, opts = {}) {
  validateName(name);
  const dir = opts.directory ? path.resolve(opts.directory) : DEFAULT_OFFLOAD_DIR;
  ensureDir(dir);
  const filePath = offloadPath(dir, name);
  const str = typeof content === 'string' ? content : String(content ?? '');

  if (fs.existsSync(filePath) && opts.overwrite !== true) {
    throw fail('E_OFFLOAD_EXISTS', `Offload exists: ${name}`);
  }

  const hash = sha256(str);
  const bytes = sizeBytes(str);

  // Durable write: open + write + fsync
  const fd = fs.openSync(filePath, 'w', 0o600);
  try {
    fs.writeFileSync(fd, str, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  return { path: filePath, name, sizeBytes: bytes, sha256: hash, written: true };
}

export function read(name, opts = {}) {
  validateName(name);
  const dir = opts.directory ? path.resolve(opts.directory) : DEFAULT_OFFLOAD_DIR;
  const filePath = offloadPath(dir, name);
  if (!fs.existsSync(filePath)) {
    throw fail('E_OFFLOAD_NOT_FOUND', `Offload not found: ${name}`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const hash = sha256(content);
  const bytes = sizeBytes(content);
  return { content, sizeBytes: bytes, sha256: hash };
}

export function readRange(name, range = {}) {
  validateName(name);
  const dir = range.directory ? path.resolve(range.directory) : (range.dir ? path.resolve(range.dir) : DEFAULT_OFFLOAD_DIR);
  const filePath = offloadPath(dir, name);
  if (!fs.existsSync(filePath)) {
    throw fail('E_OFFLOAD_NOT_FOUND', `Offload not found: ${name}`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const totalBytes = sizeBytes(content);
  const totalChars = content.length;

  let start = range.start ?? 0;
  let end = range.end ?? totalChars;

  start = Number(start);
  end = Number(end);
  if (!Number.isFinite(start)) start = 0;
  if (!Number.isFinite(end)) end = totalChars;

  start = Math.max(0, Math.min(Math.trunc(start), totalChars));
  end = Math.max(start, Math.min(Math.trunc(end), totalChars));

  const sliced = content.slice(start, end);
  return { content: sliced, rangeStart: start, rangeEnd: end, totalBytes };
}

export function list(opts = {}) {
  const dir = opts.directory ? path.resolve(opts.directory) : DEFAULT_OFFLOAD_DIR;
  try {
    ensureDir(dir);
  } catch {
    return [];
  }
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir);
  const out = [];
  for (const entry of entries) {
    if (!NAME_RE.test(entry)) continue;
    const full = path.join(dir, entry);
    let stat;
    try {
      stat = fs.statSync(full);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    let content;
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const hash = sha256(content);
    const bytes = stat.size; // or sizeBytes(content) — use byteLength for accuracy
    const createdAt = stat.mtime.toISOString();
    out.push({ name: entry, path: full, sizeBytes: bytes, createdAt, sha256: hash });
  }
  // Deterministic ordering: sort by name
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function del(name, opts = {}) {
  validateName(name);
  const dir = opts.directory ? path.resolve(opts.directory) : DEFAULT_OFFLOAD_DIR;
  const filePath = offloadPath(dir, name);
  if (!fs.existsSync(filePath)) {
    throw fail('E_OFFLOAD_NOT_FOUND', `Offload not found: ${name}`);
  }
  fs.unlinkSync(filePath);
  return { deleted: true };
}

// Alias for contract: offload.delete(name)
export { del as delete };

export const offload = {
  write,
  read,
  readRange,
  list,
  delete: del,
  estimateTokens,
  sha256,
  sizeBytes,
  DEFAULT_DIR: DEFAULT_OFFLOAD_DIR,
};

export default offload;
