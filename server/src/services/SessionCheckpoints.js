/**
 * B132 — SESSION CHECKPOINT POLICY (DeepSeek Harness
 * `packages/session/session-checkpoint-policy` mirror).
 *
 * Semantic durability: after each completed turn, a compact checkpoint of
 * the conversation (title, last N events, plan status, active goal, project
 * capsules) is written atomically, so a crash/restart can RESUME the exact
 * state. Rolling: keep the 5 most recent checkpoints per conversation.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { writeFileAtomic } from './AtomicWrite.js';
import { conversationSummary, loadConversationEvents } from './SessionConversations.js';
import { listProjectCapsules } from './ProjectCapsules.js';

const CP_DIR = path.join(DATA_DIR, 'checkpoints');
const MAX_PER_CONV = 5;
const CHECKPOINT_EVERY_N = 3; // every N completed turns

const counters = new Map(); // convId → turn count since last checkpoint

function cpFile(convId, stamp) {
  return path.join(CP_DIR, `${String(convId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60)}-${stamp}.json`);
}

/** Latest checkpoint for a conversation. */
export function latestCheckpoint(convId) {
  try {
    if (!fs.existsSync(CP_DIR)) return null;
    const files = fs.readdirSync(CP_DIR)
      .filter((f) => f.startsWith(String(convId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) + '-') && f.endsWith('.json'))
      .sort();
    if (!files.length) return null;
    return JSON.parse(fs.readFileSync(path.join(CP_DIR, files[files.length - 1]), 'utf-8'));
  } catch { return null; }
}

/** Take a checkpoint (amortized every N turns). Never throws. */
export function maybeCheckpoint(convId, { force = false } = {}) {
  try {
    if (!convId) return null;
    const n = (counters.get(convId) || 0) + 1;
    counters.set(convId, n);
    if (!force && n % CHECKPOINT_EVERY_N !== 0) return null;
    const summary = conversationSummary(convId);
    const events = loadConversationEvents(convId, 300);
    const cp = {
      at: Date.now(),
      convId,
      title: summary ? summary.title : null,
      messageCount: summary ? summary.messageCount : events.length,
      lastUser: [...events].reverse().find((e) => e.role === 'user' && e.kind === 'chat')?.text?.slice(0, 300) || null,
      lastJexi: [...events].reverse().find((e) => e.role === 'jexi' && e.kind === 'chat')?.text?.slice(0, 300) || null,
      lifecycle: events.filter((e) => e.kind === 'turn/end').slice(-3).map((e) => ({ kind: e.kind, at: e.at })),
      projects: listProjectCapsules().slice(0, 5).map((p) => ({ slug: p.slug, name: p.name, updatedAt: p.updatedAt })),
    };
    const stamp = String(Date.now());
    writeFileAtomic(cpFile(convId, stamp), JSON.stringify(cp));
    // rolling cap
    const files = fs.readdirSync(CP_DIR).filter((f) => f.startsWith(String(convId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) + '-') && f.endsWith('.json')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - MAX_PER_CONV))) {
      try { fs.unlinkSync(path.join(CP_DIR, f)); } catch { /* noop */ }
    }
    return cp;
  } catch { return null; }
}

/** List checkpoint files (metadata only). */
export function listSessionCheckpoints(convId = null) {
  try {
    if (!fs.existsSync(CP_DIR)) return [];
    return fs.readdirSync(CP_DIR).filter((f) => f.endsWith('.json'))
      .filter((f) => !convId || f.startsWith(String(convId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) + '-'))
      .sort()
      .reverse()
      .slice(0, 20)
      .map((f) => {
        try { const d = JSON.parse(fs.readFileSync(path.join(CP_DIR, f), 'utf-8')); return { file: f, at: d.at, convId: d.convId, title: d.title, messageCount: d.messageCount }; }
        catch { return { file: f }; }
      });
  } catch { return []; }
}
