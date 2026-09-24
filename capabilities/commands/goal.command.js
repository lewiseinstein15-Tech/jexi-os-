/** JEXI OS — /goal — Scope 10(G) persistent autonomous-goal lifecycle. */

async function runtimeFor(ctx) {
  // Root development layout has ../scheduler; the existing container command
  // bundle may not ship Scope G yet, so degrade this command without breaking
  // the entire command registry.
  let module;
  try { module = await import(new URL('../scheduler/autonomous/index.js', import.meta.url)); } catch { return null; }
  const candidate = String(ctx?.session?.id || 'default');
  return module.autonomousRuntime({ sessionId: /^[A-Za-z0-9_-]{1,100}$/.test(candidate) ? candidate : 'default' });
}

function optionalPositive(value) {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export default {
  name: 'goal',
  aliases: [],
  description: 'Create, inspect, or list persistent bounded autonomous goals',
  category: 'session',
  args: [
    { name: 'description', required: false, type: 'string', default: '', description: 'goal description; omit to list goals' },
    { name: 'goalId', required: false, type: 'string', default: '', description: 'inspect one goal id' },
    { name: 'maxTurns', required: false, type: 'number', default: 0, description: 'turn boundary (default 10)' },
    { name: 'maxTokens', required: false, type: 'number', default: 0, description: 'token boundary (default 100000)' },
    { name: 'maxWallMs', required: false, type: 'number', default: 0, description: 'wall-clock boundary in milliseconds (default 60000)' },
    { name: 'gateCommand', required: false, type: 'string', default: '', description: 'optional completion command, for example npm run check' },
  ],
  async handler(args, ctx) {
    const autonomous = await runtimeFor(ctx);
    if (!autonomous) return { ok: false, summary: 'autonomous scheduler is not available in this runtime', error: 'E_AUTONOMOUS_UNAVAILABLE' };
    if (String(args.goalId || '').trim()) {
      const goal = autonomous.goal.get(String(args.goalId).trim());
      return { ok: true, summary: `goal ${goal.id}: ${goal.status}`, goal };
    }
    if (!String(args.description || '').trim()) {
      const goals = autonomous.goal.list();
      return { ok: true, summary: `${goals.length} goal(s) in this session`, goals };
    }
    const created = autonomous.goal.set({
      description: String(args.description),
      maxTurns: optionalPositive(args.maxTurns),
      maxTokens: optionalPositive(args.maxTokens),
      maxWallMs: optionalPositive(args.maxWallMs),
      gateCommand: String(args.gateCommand || '').trim() || undefined,
    });
    return { ok: true, summary: `goal ${created.goalId} created`, ...created };
  },
};
