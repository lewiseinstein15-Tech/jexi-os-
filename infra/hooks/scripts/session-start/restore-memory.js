#!/usr/bin/env node
/**
 * JEXI OS — Phase 7(B) hook — restore-memory (SessionStart, warn-only).
 *
 * Fires when a session starts. If a prior session persisted memory for this
 * sessionId (hooks/state/<sid>.memory.json), prints what was restored so the
 * kernel/operator can pick up context; otherwise announces a fresh session.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const STATE_DIR = path.join(REPO_ROOT, 'hooks', 'state');

const raw = await new Promise((resolve) => {
  let buf = '';
  process.stdin.on('data', (c) => { buf += c; });
  process.stdin.on('end', () => resolve(buf));
});

let ctx = {};
try { ctx = JSON.parse(raw || '{}'); } catch { /* empty context */ }

const sessionId = String(ctx.sessionId || 'unknown');
const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
const memoryFile = path.join(STATE_DIR, `${safe}.memory.json`);

if (existsSync(memoryFile)) {
  try {
    const prior = JSON.parse(readFileSync(memoryFile, 'utf8'));
    console.log(`[restore-memory] restored memory for ${sessionId}: ${JSON.stringify(prior).slice(0, 300)}`);
  } catch (e) {
    console.log(`[restore-memory] memory file for ${sessionId} unreadable (${e.message}) — starting fresh.`);
  }
} else {
  console.log(`[restore-memory] no prior memory for ${sessionId} — fresh session.`);
}
process.exit(0);
