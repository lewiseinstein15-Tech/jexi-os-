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
    const repoRoot = serverRoot() ? path.resolve(serverRoot(), '..') : process.cwd();
    const evidence = [];
    const candidates = [];

    // ── source 1: the observation journal (fail→fix cycles are refinement gold)
    const journal = latestJournal(repoRoot);
    let sessionId = String(args.session || ctx.session.id || journal?.sessionId || '').trim();
    if (journal && (!sessionId || sessionId === journal.sessionId)) {
      try {
        const lines = fs.readFileSync(journal.file, 'utf8').split('\n').filter(Boolean);
        const rows = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        // fail→fix pairs: a failed call followed later by an ok call to the same tool
        const fails = rows.filter((r) => r.ok === false);
        for (const f of fails.slice(-5)) {
          const fix = rows.find((r) => r.ok === true && r.tool === f.tool && r.turn > f.turn);
          if (fix) {
            candidates.push({
              kind: 'error_resolution',
              edit: `when ${f.tool} fails with "${clampText(String(f.error || f.summary || ''), 80)}", apply what ${fix.tool} turn ${fix.turn} did differently BEFORE retrying`,
              evidenceRef: `journal ${journal.sessionId} turn ${f.turn} (fail) → turn ${fix.turn} (ok)`,
              weight: 0.7,
            });
          }
        }
        if (rows.length) evidence.push(`journal ${journal.sessionId}: ${rows.length} observed calls`);
      } catch { /* journal unreadable → skip source */ }
    }

    // ── source 2: the learning store — a high-confidence instinct IS a proposed edit
    try {
      const store = await rootMod('learning/store.js');
      const storeFile = store?.projectStorePath?.(repoRoot);
      if (storeFile && fs.existsSync(storeFile)) {
        const instincts = store.listInstincts(storeFile) || [];
        const best = instincts
          .filter((i) => (i.confidence ?? 0) >= 0.5)
          .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
        if (best) {
          candidates.push({
            kind: 'instinct',
            edit: `apply instinct ${best.id} (${best.type}, confidence ${(best.confidence ?? 0).toFixed(2)}) to similar ${best.type === 'error_resolution' ? 'failures' : 'situations'} before manual debugging`,
            evidenceRef: `learning store: ${best.sightings ?? (best.evidence?.length ?? '?')} sighting(s), confidence ${(best.confidence ?? 0).toFixed(2)}`,
            weight: best.confidence ?? 0.5,
          });
          evidence.push(`learning store: ${instincts.length} instinct(s) on file`);
        }
      }
    } catch { /* store optional */ }

    // ── source 3: the live conversation trace — repeated identical tool calls → propose batching
    try {
      const convId = ctx.session.id;
      if (convId) {
        const conv = await serverMod('src/services/SessionConversations.js');
        const events = conv?.loadConversationEvents?.(convId, 200) || [];
        const toolRows = events.filter((e) => e.kind === 'tool' || String(e.text || '').includes('tool'));
        if (toolRows.length >= 3) {
          candidates.push({
            kind: 'trace',
            edit: `session ${convId} logged ${toolRows.length} tool rows — batch consecutive same-tool calls into one call with a list argument`,
            evidenceRef: `conversation ${convId}: ${toolRows.length} tool rows in the last ${events.length} events`,
            weight: 0.4,
          });
          evidence.push(`conversation trace: ${events.length} events`);
        }
      }
    } catch { /* trace optional */ }

    if (!candidates.length) {
      return {
        ok: true,
        summary: 'no refinement — trajectory has no evidence-backed edit to propose',
        session: sessionId || null,
        evidence,
        candidates: [],
      };
    }

    candidates.sort((a, b) => b.weight - a.weight);
    const top = candidates[0];

    return {
      ok: true,
      summary: `refinement proposed (${top.kind}): ${clampText(top.edit, 160)} — evidence: ${top.evidenceRef}`,
      proposal: top,
      alternates: candidates.slice(1, 3),
      evidence,
      trajectorySources: evidence.length,
      session: sessionId || null,
    };
  },
};
