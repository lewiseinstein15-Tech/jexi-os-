/**
 * JEXI OS — Phase 27 Scope A — fleet internals.
 *
 * Shared error type and small fs helpers. No dependencies beyond Node stdlib.
 */
import fs from 'node:fs';
import path from 'node:path';

export class FleetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FleetError';
    this.code = code;
  }
}

export const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    throw new FleetError('E_INVALID_SESSION_ID', `invalid session id ${JSON.stringify(sessionId)}`);
  }
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

export function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, filePath);
}

export { fs, path };
