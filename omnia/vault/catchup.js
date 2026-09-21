/**
 * JEXI OS — Phase 15 Scope A — catchup (resume state).
 *
 * Changes are appended to <vault>/changes.jsonl with a monotonic
 * sequence number (no wall clocks — deterministic). catchup()
 * reports the vault state, the current plan, and the most recent
 * change batches.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadPlan } from './living-plan.js';

const changesPath = (vault) => path.join(vault, 'changes.jsonl');
const seqPath = (vault) => path.join(vault, 'seq.txt');

export function recordChange(vault, actions) {
  if (!Array.isArray(actions) || actions.length === 0) return null;
  let seq = 0;
  try { seq = parseInt(fs.readFileSync(seqPath(vault), 'utf8'), 10) || 0; } catch { seq = 0; }
  seq += 1;
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(seqPath(vault), String(seq));
  fs.appendFileSync(changesPath(vault), JSON.stringify({ seq, actions }) + '\n');
  return seq;
}

export function recentChanges(vault, limit = 10) {
  if (!fs.existsSync(changesPath(vault))) return [];
  const lines = fs.readFileSync(changesPath(vault), 'utf8').split('\n').filter((l) => l.trim() !== '');
  return lines.slice(-limit).map((l) => JSON.parse(l));
}

export function catchup(vault) {
  const plan = loadPlan(vault);
  const state = plan.items.length === 0 ? 'empty' : 'ready';
  return { state, plan, recentChanges: recentChanges(vault) };
}
