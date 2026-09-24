/**
 * JEXI OS — COMMANDS — /export (Phase 7 G).
 *
 * Exports the session as JSON: the real conversation events
 * (SessionConversations), the current HUD payload, the spend ledger and the
 * active plan — written to <DATA_DIR>/exports/ and the path returned.
 */

import path from 'node:path';
import fs from 'node:fs';
import { dataDir, hudProducer, hudSnapshot, serverMod } from './_context.js';

export default {
  name: 'export',
  aliases: [],
  description: 'Export the session as JSON (conversation + HUD + spend + plan)',
  category: 'session',
  args: [
    { name: 'session', required: false, type: 'string', default: '', description: 'conversation id (default: ctx session or the most recent)' },
    { name: 'out', required: false, type: 'path', default: '', description: 'override the output file path' },
  ],
  async handler(args, ctx) {
    // ── conversation events (real store) ─────────────────────────────────
    let convId = String(args.session || ctx.session.id || '').trim();
    let events = [];
    const Conv = await serverMod('src/services/SessionConversations.js');
    if (Conv?.listConversations && Conv?.loadConversationEvents) {
      try {
        if (!convId) {
          const all = Conv.listConversations() || [];
          convId = (all[0] && (all[0].id || all[0].convId)) || '';
        }
        if (convId) events = Conv.loadConversationEvents(convId, 500) || [];
      } catch { events = []; }
    }

    // ── HUD + spend + plan ───────────────────────────────────────────────
    const hudRaw = await hudSnapshot();
    const hud = hudRaw?.payload || hudRaw || null;
    let spend = [];
    try {
      const p = await hudProducer();
      spend = (p?.producerState?.spend || []).map((s) => ({ t: s.t, usd: s.usd, provider: s.provider, model: s.model }));
    } catch { spend = []; }
    let plan = null;
    try {
      const P = await serverMod('src/services/PlanStore.js');
      plan = P?.planGet?.() || null;
    } catch { plan = null; }

    const payload = {
      schema: 'jexi.session-export.v1',
      exportedAt: new Date().toISOString(),
      session: {
        id: convId || ctx.session.id || null,
        missionId: ctx.session.missionId || null,
        agentId: ctx.session.agentId || hud?.agentId || null,
      },
      conversation: { id: convId || null, eventCount: events.length, events },
      hud,
      spend,
      plan,
      git: ctx._git || null,
    };

    // ── write ────────────────────────────────────────────────────────────
    const safeId = String(convId || 'session').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
    const file = args.out
      ? path.resolve(String(args.out))
      : path.join(await dataDir(), 'exports', `${safeId}-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload, null, 1), 'utf8');
    const bytes = fs.statSync(file).size;

    return {
      ok: true,
      summary: `session exported → ${file} (${bytes} bytes, ${events.length} conversation event(s), ${spend.length} spend row(s))`,
      path: file,
      bytes,
      eventCount: events.length,
      spendRows: spend.length,
    };
  },
};
