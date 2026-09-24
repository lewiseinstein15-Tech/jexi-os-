#!/usr/bin/env node
/**
 * JEXI OS — Phase 7(B) hook — save-checkpoint (PreCompact, warn-only).
 *
 * Fires just before a conversation is compacted. Persists a checkpoint file
 * (hooks/state/<sid>.checkpoint.json) recording what is about to be compacted
 * so state can be recovered if compaction goes sideways.
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

const sessionId = String(ctx.sessionId || ctx.conversationId || 'unknown');
const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
const checkpoint = {
  at: new Date().toISOString(),
  event: 'PreCompact',
  sessionId,
  conversationId: ctx.conversationId || null,
  force: Boolean(ctx.force),
  note: 'checkpoint written before compaction rewrote history',
};

try {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(path.join(STATE_DIR, `${safe}.checkpoint.json`), JSON.stringify(checkpoint, null, 2));
  console.log(`[save-checkpoint] checkpoint saved for ${sessionId} before compaction.`);
} catch (e) {
  console.log(`[save-checkpoint] checkpoint skipped for ${sessionId} (${e.message}) — compaction proceeds.`);
}
process.exit(0);
