#!/usr/bin/env node
/**
 * JEXI OS — Phase 7(B) hook — persist-memory (SessionEnd, warn-only).
 *
 * Fires when a session ends (graceful shutdown / explicit session close).
 * Persists a compact memory record (hooks/state/<sid>.memory.json) that a
 * later SessionStart can restore.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const STATE_DIR = path.join(REPO_ROOT, 'infra/hooks', 'state');

const raw = await new Promise((resolve) => {
  let buf = '';
  process.stdin.on('data', (c) => { buf += c; });
  process.stdin.on('end', () => resolve(buf));
});

let ctx = {};
try { ctx = JSON.parse(raw || '{}'); } catch { /* empty context */ }

const sessionId = String(ctx.sessionId || 'unknown');
const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
const memory = {
  at: new Date().toISOString(),
  event: 'SessionEnd',
  sessionId,
  agentId: ctx.agentId || null,
  reason: String(ctx.reason || 'shutdown'),
  memory: { lastSeenAt: new Date().toISOString(), note: 'persisted by session-end hook' },
};

try {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(path.join(STATE_DIR, `${safe}.memory.json`), JSON.stringify(memory, null, 2));
  console.log(`[persist-memory] memory persisted for ${sessionId} (reason: ${memory.reason}).`);
} catch (e) {
  console.log(`[persist-memory] persist skipped for ${sessionId} (${e.message}).`);
}
process.exit(0);
