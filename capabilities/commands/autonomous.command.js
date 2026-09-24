/** JEXI OS — /autonomous — Scope 10(G) bounded continuation command seam. */

async function runtimeFor(ctx) {
  try {
    const module = await import(new URL('../scheduler/autonomous/index.js', import.meta.url));
    const candidate = String(ctx?.session?.id || 'default');
    return module.autonomousRuntime({ sessionId: /^[A-Za-z0-9_-]{1,100}$/.test(candidate) ? candidate : 'default' });
  } catch { return null; }
}

export default {
  name: 'autonomous',
  aliases: [],
  description: 'Run an active goal through a host-provided bounded task runner',
  category: 'session',
  args: [
    { name: 'goalId', required: true, type: 'string', description: 'goal id to continue' },
  ],
  async handler(args, ctx) {
    // Scope G owns the safe loop, not a model/provider work implementation.
    // A host can invoke this handler with autonomousTaskRunner; without one,
    // reporting unavailable is safer than inventing completed work.
    if (typeof ctx?.autonomousTaskRunner !== 'function') {
      return {
        ok: false,
        summary: 'autonomous task runner is not available in this command context',
        error: 'E_TASK_RUNNER_UNAVAILABLE',
      };
    }
    const autonomous = await runtimeFor(ctx);
    if (!autonomous) return { ok: false, summary: 'autonomous scheduler is not available in this runtime', error: 'E_AUTONOMOUS_UNAVAILABLE' };
    const result = await autonomous.continuation.run(String(args.goalId), ctx.autonomousTaskRunner);
    return {
      ok: result.stoppedBecause === 'goal-complete',
      summary: `autonomous ${args.goalId}: ${result.stoppedBecause} after ${result.turnsRun} turn(s)`,
      ...result,
    };
  },
};
