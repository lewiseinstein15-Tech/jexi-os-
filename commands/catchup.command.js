/**
 * JEXI OS — COMMANDS — /catchup (Phase 7 G).
 *
 * Reads the STATE.md written by /handoff and summarizes it into a briefing.
 * Real file read; a missing file is an honest miss, never a fake summary.
 */

import path from 'node:path';
import fs from 'node:fs';
import { stateFilePath } from './_context.js';

const SECTIONS = ['Now', 'Just landed', 'Next', 'Open questions', 'Watch out'];

export default {
  name: 'catchup',
  aliases: [],
  description: 'Read STATE.md and summarize where the last agent left off',
  category: 'relay',
  args: [
    { name: 'file', required: false, type: 'path', default: '', description: 'override the STATE.md path (default: <DATA_DIR>/handoff/STATE.md)' },
  ],
  async handler(args, ctx) {
    const file = args.file ? path.resolve(String(args.file)) : await stateFilePath();
    if (!fs.existsSync(file)) {
      return { ok: false, summary: `no STATE.md at ${file} — run /handoff first`, error: 'missing STATE.md', path: file };
    }

    const raw = fs.readFileSync(file, 'utf8');
    const parsed = {};
    let current = null;
    for (const line of raw.split('\n')) {
      const h = line.match(/^##\s+(.+)$/);
      if (h && SECTIONS.includes(h[1].trim())) { current = h[1].trim(); parsed[current] = []; continue; }
      if (current && line.trim() && !line.startsWith('_written')) parsed[current].push(line.trim().replace(/^-\s*/, ''));
    }

    const nextCount = parsed['Next']?.length ?? 0;
    const watchCount = parsed['Watch out']?.length ?? 0;
    const firstNext = parsed['Next']?.[0] || '(nothing)';

    return {
      ok: true,
      summary: `caught up from ${path.basename(file)}: now ${parsed['Now']?.[0] || 'unknown'} — next up: ${firstNext} (${nextCount} item(s) queued, ${watchCount} watch item(s))`,
      path: file,
      sections: parsed,
      writtenAt: (raw.match(/_written ([^\s]+)/) || [])[1] || null,
    };
  },
};
