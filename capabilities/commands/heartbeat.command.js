/** JEXI OS — /heartbeat — Scope 10(G) in-process autonomous goal pings. */

async function runtimeFor(ctx) {
  try {
    const module = await import(new URL('../scheduler/autonomous/index.js', import.meta.url));
    const candidate = String(ctx?.session?.id || 'default');
    return module.autonomousRuntime({ sessionId: /^[A-Za-z0-9_-]{1,100}$/.test(candidate) ? candidate : 'default' });
  } catch { return null; }
}

export default {
  name: 'heartbeat',
  aliases: [],
  description: 'Schedule or cancel in-process heartbeat pings for an active goal',
  category: 'session',
  args: [
    { name: 'goalId', required: false, type: 'string', default: '', description: 'active goal to ping' },
    { name: 'everyMs', required: false, type: 'number', default: 60_000, description: 'ping interval in milliseconds' },
    { name: 'maxPings', required: false, type: 'number', default: 0, description: 'optional stop after this many pings' },
    { name: 'cancel', required: false, type: 'string', default: '', description: 'schedule id to cancel' },
  ],
  async handler(args, ctx) {
    const autonomous = await runtimeFor(ctx);
    if (!autonomous) return { ok: false, summary: 'autonomous scheduler is not available in this runtime', error: 'E_AUTONOMOUS_UNAVAILABLE' };
    const heartbeat = autonomous.heartbeat;
    if (String(args.cancel || '').trim()) {
      const cancelled = heartbeat.cancel(String(args.cancel).trim());
      return { ok: true, summary: `heartbeat ${args.cancel} cancelled`, ...cancelled };
    }
    if (!String(args.goalId || '').trim()) {
      return { ok: false, summary: 'heartbeat requires goalId or --cancel scheduleId', error: 'E_GOAL_ID' };
    }
    const scheduled = heartbeat.schedule(String(args.goalId).trim(), {
      everyMs: args.everyMs,
      maxPings: Number.isFinite(args.maxPings) && args.maxPings > 0 ? args.maxPings : undefined,
    });
    return { ok: true, summary: `heartbeat ${scheduled.scheduleId} scheduled`, ...scheduled };
  },
};
