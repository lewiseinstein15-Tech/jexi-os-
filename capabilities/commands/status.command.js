/**
 * JEXI OS — COMMANDS — /status (Phase 7 G).
 *
 * ONE line, from the REAL HUD payload (events/hud/producer.js — the same
 * payload the console TopBar renders). No HUD in this runtime → an honest
 * minimal line, not a fake one.
 */

import { hudSnapshot } from './_context.js';

function usd(n) { return `$${(Number(n) || 0).toFixed(4)}`; }

export default {
  name: 'status',
  aliases: [],
  description: 'One-line state summary from the current HUD payload',
  category: 'session',
  args: [],
  async handler(args, ctx) {
    const snap = await hudSnapshot();
    const hud = snap?.payload || snap;

    if (!hud) {
      const up = Math.round(process.uptime());
      return {
        ok: true,
        summary: `status: runtime up ${up}s — HUD not available in this runtime (events/hud missing)`,
        hud: null,
      };
    }

    const bits = [];
    bits.push(`rev ${snap?.revision ?? '?'}`);
    if (hud.sessionId) bits.push(`session ${hud.sessionId}`);
    if (hud.cost?.sessionUsd != null) bits.push(`cost ${usd(hud.cost.sessionUsd)} ${hud.cost.trend || 'flat'}`);
    const recent = hud.toolCalls?.recent?.length ?? 0;
    const pending = hud.toolCalls?.pending?.length ?? 0;
    if (recent || pending) bits.push(`tools ${recent} recent / ${pending} pending`);
    if (hud.todos?.open != null) bits.push(`todos ${hud.todos.open} open`);
    if (hud.queueState?.waiting != null) bits.push(`queue ${hud.queueState.waiting} waiting`);
    if (hud.agents?.active != null) bits.push(`agents ${hud.agents.active}`);
    if (hud.risk?.level) bits.push(`risk ${hud.risk.level}`);

    return {
      ok: true,
      summary: `status: ${bits.join(' · ')}`,
      hud,
      revision: snap?.revision ?? null,
    };
  },
};
