/**
 * JEXI OS — COMMANDS — /refine (Phase 7 G).
 *
 * Continual-improvement refinement: reads the REAL trajectory (session
 * observation journal + conversation trace + learning store), proposes ONE
 * evidence-backed edit. Evidence means: the proposal cites the concrete
 * journal/trace rows it is based on. With no usable evidence the command
 * says "no refinement" — it never invents a proposal.
 */

import path from 'node:path';
import fs from 'node:fs';
import { rootMod, serverRoot, serverMod, clampText, redact } from './_context.js';

function latestJournal(repoRoot) {
  const dir = path.join(repoRoot, '.jexi', 'learning', 'journal');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files[0] ? { sessionId: files[0].f.replace(/\.jsonl$/, ''), file: path.join(dir, files[0].f) } : null;
}

export default {
  name: 'refine',
  aliases: [],
  description: 'Read the trajectory and propose one evidence-backed workflow edit',
  category: 'learning',
  args: [
    { name: 'session', required: false, type: 'string', default: '', description: 'session id (default: the newest journal)' },
  ],
  async handler(args, ctx) {
    const { run } = await import('../../harness/refine/index.js');
    const trajectoryId = String(args.session || ctx?.session?.id || '').trim() || undefined;
    try {
      return { ok: true, ...await run(trajectoryId) };
    } catch (error) {
      if (error.code !== 'E_NO_EVIDENCE') throw error;
      return { ok: false, reason: 'no-evidence', message: 'No refinement: no evidence in trajectory' };
    }
  },
};
