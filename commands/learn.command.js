/**
 * JEXI OS — COMMANDS — /learn (Phase 7 G).
 *
 * Runs the REAL Phase 7(C) analyzer (learning/analyzer.js) over a session
 * and reports the instincts it extracts. Honest output: "none found" is a
 * valid, expected result for a short session.
 */

import path from 'node:path';
import fs from 'node:fs';
import { rootMod, serverRoot } from './_context.js';

export default {
  name: 'learn',
  aliases: [],
  description: 'Run the learning analyzer on a session and extract instincts',
  category: 'learning',
  args: [
    { name: 'session', required: false, type: 'string', default: '', description: 'session id (default: the current/latest journal session)' },
  ],
  async handler(args, ctx) {
    const analyzer = await rootMod('learning/analyzer.js');
    if (!analyzer?.analyzeSession) {
      return { ok: false, summary: 'learning subsystem not available in this runtime (learning/ not shipped here)', error: 'learning/analyzer.js missing' };
    }

    const repoRoot = serverRoot() ? path.resolve(serverRoot(), '..') : process.cwd();

    // pick the session: explicit arg → ctx session → newest journal file
    let sessionId = String(args.session || ctx.session.id || '').trim();
    if (!sessionId) {
      try {
        const journalDir = path.join(repoRoot, '.jexi', 'learning', 'journal');
        if (fs.existsSync(journalDir)) {
          const files = fs.readdirSync(journalDir).filter((f) => f.endsWith('.jsonl') && !f.endsWith('.analyzed'));
          const newest = files
            .map((f) => ({ f, m: fs.statSync(path.join(journalDir, f)).mtimeMs }))
            .sort((a, b) => b.m - a.m)[0];
          if (newest) sessionId = newest.f.replace(/\.jsonl$/, '');
        }
      } catch { sessionId = ''; }
    }
    if (!sessionId) {
      return { ok: false, summary: 'no session id given and no observation journal found — make tool calls first', error: 'no-session' };
    }

    ctx.log(`analyzer running on session ${sessionId}…`);
    const out = analyzer.analyzeSession(repoRoot, sessionId, { force: true });

    const instincts = Array.isArray(out?.extracted) ? out.extracted : [];
    const count = instincts.length;

    return {
      ok: true,
      summary: count
        ? `analyzer ran on ${sessionId} — ${count} instinct(s) extracted: ${instincts.map((i) => `${i.type}(${(i.confidence ?? 0).toFixed ? i.confidence.toFixed(2) : i.confidence})`).join(', ')}`
        : `analyzer ran on ${sessionId} — none found (session had no extractable fail→fix / technique patterns)`,
      session: sessionId,
      count,
      instincts: instincts.slice(0, 10).map((i) => ({
        id: i.id, type: i.type, confidence: i.confidence,
        evidence: Array.isArray(i.evidence) ? i.evidence.length : 0,
      })),
      analyzer: 'learning/analyzer.js (Phase 7 C)',
    };
  },
};
