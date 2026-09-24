#!/usr/bin/env node
/**
 * JEXI OS — Phase 7(B) hook — evaluate-session (Stop, warn-only).
 *
 * Fires at turn/mission end. Writes a JSONL evaluation record to
 * hooks/state/session-evals.jsonl and prints a one-line verdict.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
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
const state = String(ctx.state || '');
const verdict = state ? (state === 'COMPLETED' ? 'completed' : `ended:${state.toLowerCase()}`) : 'turn-complete';
const objective = String(ctx.objective || '').slice(0, 300);

const record = {
  at: new Date().toISOString(),
  event: 'Stop',
  sessionId,
  agentId: ctx.agentId || null,
  verdict,
  objective,
};

try {
  mkdirSync(STATE_DIR, { recursive: true });
  appendFileSync(path.join(STATE_DIR, 'session-evals.jsonl'), JSON.stringify(record) + '\n');
  console.log(`[evaluate-session] Stop — session ${sessionId} → ${verdict}${objective ? ` (${objective})` : ''} — recorded.`);
} catch (e) {
  console.log(`[evaluate-session] Stop — evaluated ${sessionId} → ${verdict} (state write skipped: ${e.message})`);
}
process.exit(0);
