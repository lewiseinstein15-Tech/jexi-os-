/**
 * JEXI OS — COMMANDS — /checkpoint (Phase 7 G).
 *
 * Saves a restorable work-graph snapshot through the REAL workgraph
 * checkpoint module (server/src/workgraph/state/checkpoint.js — SQLite,
 * write-ahead). The graph is built from the runtime's ACTUAL work state:
 * plan steps (PlanStore), todos (TodoStore) and recent missions (Mission).
 * A synthetic graph would be a fake probe — this one is the live state.
 */

import path from 'node:path';
import { serverMod, dataDir } from './_context.js';

export default {
  name: 'checkpoint',
  aliases: ['cp'],
  description: 'Save a work-graph checkpoint (restorable snapshot of plan + todos + missions)',
  category: 'session',
  args: [
    { name: 'label', required: false, type: 'string', default: '', description: 'optional label stored in the checkpoint meta' },
  ],
  async handler(args, ctx) {
    const wgIndex = await serverMod('src/workgraph/index.js');
    const checkpointMod = await serverMod('src/workgraph/state/checkpoint.js');
    if (!checkpointMod || typeof checkpointMod.saveCheckpoint !== 'function') {
      return { ok: false, summary: 'workgraph checkpoint subsystem not available in this runtime', error: 'workgraph/state/checkpoint.js missing' };
    }
    if (!wgIndex) {
      return { ok: false, summary: 'workgraph subsystem not available in this runtime', error: 'workgraph/index.js missing' };
    }

    // ── collect the runtime's real work state ────────────────────────────
    const nodes = [];
    const nodeFactory = wgIndex;

    // 1. mission nodes — recent real missions
    let missions = [];
    try {
      const M = await serverMod('src/services/director/Mission.js');
      if (M?.listMissions) missions = (await M.listMissions(null, 5)) || [];
    } catch { /* missions optional */ }

    // 2. plan steps — the active plan (PlanStore)
    let plan = null;
    try {
      const P = await serverMod('src/services/PlanStore.js');
      if (P?.planGet) plan = P.planGet();
    } catch { /* plan optional */ }

    // 3. todos
    let todos = [];
    try {
      const T = await serverMod('src/services/TodoStore.js');
      if (T?.todoList) todos = T.todoList() || [];
    } catch { /* todos optional */ }

    const sessionId = ctx.session.id || 'local';

    if (missions.length) {
      for (const m of missions.slice(0, 3)) {
        nodes.push(nodeFactory.createMissionNode({
          id: `mission:${m.id || m.missionId || String(m.createdAt || 'x')}`,
          objective: String(m.goal || m.objective || m.title || 'mission').slice(0, 200),
        }));
      }
    }
    if (plan?.steps?.length) {
      nodes.push(nodeFactory.createTaskNode({
        id: `plan:${sessionId}`,
        objective: `plan "${String(plan.title || 'active').slice(0, 120)}" — ${plan.steps.length} steps (${plan.steps.filter((s) => s.status === 'completed' || s.status === 'done').length} done)`,
      }));
    }
    if (todos.length) {
      nodes.push(nodeFactory.createTaskNode({
        id: `todos:${sessionId}`,
        objective: `${todos.filter((t) => !t.done).length} open / ${todos.length} total todos`,
      }));
    }
    if (!nodes.length) {
      nodes.push(nodeFactory.createTaskNode({
        id: `idle:${sessionId}`,
        objective: 'no live plan/todos/missions at checkpoint time (idle state snapshot)',
      }));
    }

    const graph = { nodes, savedAt: Date.now() };
    const file = path.join(await dataDir(), 'workgraph', 'checkpoint.sqlite');
    const meta = { label: String(args.label || ''), sessionId, by: ctx.agent.name, source: 'command:/checkpoint' };
    const saved = await checkpointMod.saveCheckpoint(file, graph, { meta });

    // prove restorability with the module's own loader (real round-trip)
    let restored = null;
    try {
      const back = await checkpointMod.loadCheckpoint(file);
      restored = back ? { nodeCount: back.graph?.nodes?.length ?? 0, savedAt: back.savedAt } : null;
    } catch { restored = null; }

    return {
      ok: true,
      summary: `checkpoint saved → ${file} (${saved.nodeCount} nodes${restored ? `, restore-verified ${restored.nodeCount}` : ''})`,
      path: file,
      nodeCount: saved.nodeCount,
      restored,
      meta,
    };
  },
};
