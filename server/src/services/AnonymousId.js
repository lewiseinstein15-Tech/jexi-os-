/**
 * B133 — ANONYMOUS USER ID (DeepSeek Harness
 * `packages/identity/anonymous-user-id` mirror).
 *
 * A random UUID persisted as a bare line in DATA_DIR/.anonymous-user-id,
 * never derived from hostname/IP/git. Memoized per process; deleting the
 * file mints a fresh identity. Used by telemetry + feedback so aggregates
 * are per-user without any PII.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR } from '../config.js';

const FILE_NAME = '.anonymous-user-id';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let memoized = null;

/** Resolve (and persist) the anonymous user id. */
export function anonymousUserId() {
  if (memoized) return memoized;
  const file = path.join(DATA_DIR, FILE_NAME);
  try {
    if (fs.existsSync(file)) {
      const line = fs.readFileSync(file, 'utf-8').trim();
      if (UUID_PATTERN.test(line)) { memoized = line; return line; }
    }
  } catch { /* fall through to mint */ }
  const id = crypto.randomUUID();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, id + '\n', 'utf-8');
  } catch { /* best-effort */ }
  memoized = id;
  return id;
}

/** Reset the memo (tests). */
export function resetAnonymousUserId() { memoized = null; }
