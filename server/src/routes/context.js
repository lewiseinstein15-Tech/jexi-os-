/**
 * JEXI OS — Phase 6 Scope C: context manager HTTP surface.
 *
 *   GET  /api/context/sources           → registered context sources
 *   GET  /api/context/pressure          → pressure for given used/budget tokens
 *   GET  /api/context/taskStats         → task-registry counters (the console
 *                                          MemoryView advertises this exact
 *                                          path as the counters source)
 *   POST /api/context/build             → build a budgeted request (returns
 *                                          messages + usage + kept/clipped/dropped)
 *   POST /api/context/pack              → greedy item packing under a token cap
 *   POST /api/context/compact           → deterministic range compaction
 *
 * Mounted from index.js via mountContext(app).
 */

import {
  ContextManager,
  build,
  packItems,
  compact,
  contextPressure,
  listSources,
} from '../context/index.js';
import { taskStats } from '../services/TaskRegistry.js';

function ok(res, body) { res.json({ ok: true, ...body }); }
function fail(res, e, code = 500) { res.status(code).json({ ok: false, error: String(e?.message || e).slice(0, 300) }); }

export function mountContext(app) {
  app.get('/api/context/sources', (req, res) => {
    try { ok(res, { sources: listSources(), budgets: ContextManager.DEFAULT_BUDGETS }); }
    catch (e) { fail(res, e); }
  });

  app.get('/api/context/pressure', (req, res) => {
    try {
      ok(res, { pressure: contextPressure(Number(req.query.used) || 0, Number(req.query.budget) || 8000) });
    } catch (e) { fail(res, e); }
  });

  // The console MemoryView renders this path as the source of its task
  // counters — serve it instead of 404ing on the advertised contract.
  app.get('/api/context/taskStats', (req, res) => {
    try { ok(res, { taskStats: taskStats() }); }
    catch (e) { fail(res, e); }
  });

  app.post('/api/context/build', async (req, res) => {
    try {
      const body = req.body || {};
      const report = await build(body.input || body, { budget: body.budget, system: body.system, only: body.only });
      ok(res, report);
    } catch (e) { fail(res, e); }
  });

  app.post('/api/context/pack', (req, res) => {
    try {
      const { items = [], ...opts } = req.body || {};
      ok(res, { packed: packItems(items, opts) });
    } catch (e) { fail(res, e); }
  });

  app.post('/api/context/compact', async (req, res) => {
    try {
      const { events = [], ...opts } = req.body || {};
      ok(res, { compacted: await compact(events, opts) });
    } catch (e) { fail(res, e); }
  });
}

export { build, packItems, compact, contextPressure, listSources };