/**
 * JEXI OS — Phase 6 Scope B: scheduler HTTP surface.
 *
 * Read/manage the autonomy scheduler:
 *   GET    /api/scheduler/jobs            → job history + counts (recent runs)
 *   GET    /api/scheduler/jobs/:runId     → one run with its job
 *   GET    /api/scheduler/autonomy        → engine status (pool, resources, fairness)
 *   POST   /api/scheduler/jobs            → create a job
 *   POST   /api/scheduler/jobs/:id/run    → run a job now
 *   POST   /api/scheduler/jobs/:id/toggle → enable/disable
 *   DELETE /api/scheduler/jobs/:id        → delete a job
 *
 * Mounted from index.js via mountScheduler(app).
 */

import { autonomyScheduler, registerCondition, registerAction } from '../scheduler/index.js';

function ok(res, body) { res.json({ ok: true, ...body }); }
function fail(res, e, code = 500) { res.status(code).json({ ok: false, error: String(e?.message || e).slice(0, 300) }); }

export function mountScheduler(app) {
  // A couple of real, dependency-free conditions/actions so the API is usable
  // out of the box. Applications register their own on top of these.
  registerCondition('always', async () => true);
  registerCondition('never', async () => false);

  app.get('/api/scheduler/jobs', (req, res) => {
    try {
      const sched = autonomyScheduler();
      const limit = Math.min(200, Number(req.query.limit) || 25);
      ok(res, sched.history({ limit, status: req.query.status || '' }));
    } catch (e) { fail(res, e); }
  });

  app.get('/api/scheduler/jobs/:runId', (req, res) => {
    try {
      const report = autonomyScheduler().runReport(req.params.runId);
      if (!report) return res.status(404).json({ ok: false, error: 'run not found' });
      ok(res, report);
    } catch (e) { fail(res, e); }
  });

  app.get('/api/scheduler/autonomy', (req, res) => {
    try { ok(res, { status: autonomyScheduler().status(), jobs: autonomyScheduler().listJobs({ limit: 100 }) }); }
    catch (e) { fail(res, e); }
  });

  app.post('/api/scheduler/jobs', (req, res) => {
    try {
      const out = autonomyScheduler().createJob(req.body || {});
      if (!out.ok) return res.status(400).json(out);
      ok(res, { job: out.job });
    } catch (e) { fail(res, e); }
  });

  app.post('/api/scheduler/jobs/:id/run', (req, res) => {
    try {
      const out = autonomyScheduler().runNow(req.params.id);
      if (!out.ok) return res.status(404).json(out);
      ok(res, { run: out.run });
    } catch (e) { fail(res, e); }
  });

  app.post('/api/scheduler/jobs/:id/toggle', (req, res) => {
    try {
      const enabled = req.body?.enabled !== false;
      const out = autonomyScheduler().setEnabled(req.params.id, enabled);
      if (!out.ok) return res.status(404).json(out);
      ok(res, { job: out.job });
    } catch (e) { fail(res, e); }
  });

  app.delete('/api/scheduler/jobs/:id', (req, res) => {
    try { ok(res, { ...autonomyScheduler().deleteJob(req.params.id) }); }
    catch (e) { fail(res, e); }
  });
}

export { registerCondition, registerAction };