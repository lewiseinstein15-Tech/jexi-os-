/**
 * JEXI OS — COMMANDS — /cost-report (Phase 7 G).
 *
 * Reads the REAL session spend ledger from the HUD producer
 * (events/hud/producer.js — every model call walks hud-seam → noteSpend with
 * real in/out char sizes and the provider's price table). This is the same
 * ledger the console Cost panel renders — no second bookkeeping.
 */

import { hudProducer } from './_context.js';

function usd(n) { return `$${(Number(n) || 0).toFixed(6)}`; }

export default {
  name: 'cost-report',
  aliases: ['cost'],
  description: 'Session spend summary from the provider bridge (HUD spend ledger)',
  category: 'cost',
  args: [
    { name: 'window', required: false, type: 'number', default: 0, description: 'only calls newer than this many minutes' },
  ],
  async handler(args, ctx) {
    const p = await hudProducer();
    if (!p || !p.producerState) {
      return { ok: false, summary: 'HUD spend ledger not available in this runtime (events/hud missing)', error: 'events/hud/producer.js missing' };
    }

    // state.spend IS the ledger the HUD cost section sums (real model-call
    // sizes pushed by hud-seam.noteSpend on every provider walk).
    const ledgerRaw = Array.isArray(p.producerState.spend) ? p.producerState.spend : [];
    const snap = typeof p.snapshot === 'function' ? p.snapshot() : null;
    const publishedSessionUsd = Number(snap?.payload?.cost?.sessionUsd ?? 0);

    let rows = ledgerRaw.map((s) => ({
      at: s.t ? new Date(s.t).toISOString() : null,
      usd: Number(s.usd) || 0,
      provider: s.provider || 'unknown',
      model: s.model || null,
    }));
    if (args.window > 0) {
      const cut = Date.now() - Number(args.window) * 60000;
      rows = rows.filter((r) => r.at && new Date(r.at).getTime() >= cut);
    }

    const byProvider = {};
    const byModel = {};
    for (const r of rows) {
      byProvider[r.provider] = (byProvider[r.provider] || 0) + r.usd;
      const mk = `${r.provider}/${r.model || '?'}`;
      byModel[mk] = (byModel[mk] || 0) + r.usd;
    }

    const windowUsd = rows.reduce((a, r) => a + r.usd, 0);
    if (!ledgerRaw.length) {
      return {
        ok: true,
        summary: 'no model calls recorded yet — the spend ledger fills as real turns run',
        ledger: [], sessionUsd: 0, windowUsd: 0, byProvider: {}, byModel: {},
      };
    }

    const sessionUsd = ledgerRaw.reduce((a, s) => a + (Number(s.usd) || 0), 0);
    const top = Object.entries(byProvider).sort((a, b) => b[1] - a[1])
      .map(([prov, u]) => `${prov} ${usd(u)}`)
      .join(', ');

    return {
      ok: true,
      summary: args.window > 0
        ? `spend last ${args.window}m: ${usd(windowUsd)} across ${rows.length} call(s) (${top || 'none'})`
        : `session spend: ${usd(sessionUsd)} across ${ledgerRaw.length} call(s) (${top || 'none'})`,
      sessionUsd,
      hudSessionUsd: publishedSessionUsd,
      windowUsd,
      calls: rows.length,
      byProvider,
      byModel,
      ledger: rows.slice(-20),
      source: 'events/hud/producer.js producerState.spend (fed by the provider walk via hud-seam.noteSpend)',
    };
  },
};
