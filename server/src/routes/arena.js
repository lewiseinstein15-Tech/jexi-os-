/**
 * ARENA ASTRA REBUILD — HTTP surface for the executive architecture.
 *
 * All endpoints are read-only observability + safe controls. No secrets are
 * ever returned (keys/URLs stay server-side; status booleans only).
 *
 *   GET  /api/kernel/status      kernel + meter + reasoning + scheduler snapshot
 *   POST /api/intent/classify    { text } → deterministic intent (zero model calls)
 *   GET  /api/observer/recent    ?limit &typePrefix &missionId → live event feed
 *   GET  /api/observer/stats     event counts by namespace
 *   GET  /api/vault/status       memory vault counts + lifecycle
 *   POST /api/vault/remember     { category, content, source? } → store useful knowledge
 *   GET  /api/market/status      JEXI Market connection state (no secrets)
 *   GET  /api/reasoning/health   provider ladder health
 *   GET  /api/scheduler/status   ?missionId → dispatch state
 *   POST /api/scheduler/control  { missionId, action: pause|resume|cancel }
 *   GET  /api/persona            public persona only (never the private profile)
 *   GET  /api/improve/anomalies  deterministic anomaly scan over recent events
 *   GET  /api/improve/proposals  open improvement proposals (safe ledger)
 */

export function mountArena(app) {
  // ── kernel status ────────────────────────────────────────────────
  app.get('/api/kernel/status', async (req, res) => {
    try {
      const [{ schedulerStatus }, { stats }, reasoning, ollama] = await Promise.all([
        import('../services/Scheduler.js'),
        import('../services/Observer.js'),
        import('../services/ReasoningEngine.js').catch(() => null),
        import('../services/OllamaProvider.js').catch(() => null),
      ]);
      let reasoningHealth = null;
      try { reasoningHealth = await reasoning?.reasoningHealth?.(); } catch { reasoningHealth = { error: 'health probe failed' }; }
      res.json({
        ok: true,
        kernel: 'JEXI Executive Kernel',
        observer: stats(),
        scheduler: schedulerStatus(),
        reasoning: reasoningHealth ? { ladder: reasoningHealth.ladder, providers: Object.fromEntries(Object.entries(reasoningHealth.providers || {}).map(([k, v]) => [k, { ok: !!v.ok, ms: v.ms ?? null, error: v.error || null }])) } : null,
        ollamaPreferred: ollama ? ollama.ollamaConfig().preferred : false,
        modelProvider: process.env.MODEL_PROVIDER || 'auto',
        at: new Date().toISOString(),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) });
    }
  });

  // ── intent (deterministic, zero model calls) ─────────────────────
  app.post('/api/intent/classify', async (req, res) => {
    try {
      const { classify } = await import('../services/IntentEngine.js');
      res.json({ ok: true, result: classify(req.body?.text || '', { activeMission: !!req.body?.activeMission, missionId: req.body?.missionId || null }) });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) });
    }
  });

  // ── observer ─────────────────────────────────────────────────────
  app.get('/api/observer/recent', async (req, res) => {
    try {
      const { recent } = await import('../services/Observer.js');
      res.json({ ok: true, events: recent({ limit: req.query.limit, typePrefix: req.query.typePrefix || '', missionId: req.query.missionId || '' }) });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) });
    }
  });
  app.get('/api/observer/stats', async (req, res) => {
    try {
      const { stats } = await import('../services/Observer.js');
      res.json({ ok: true, ...stats() });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) });
    }
  });

  // ── memory vault ─────────────────────────────────────────────────
  app.get('/api/vault/status', async (req, res) => {
    try {
      const { vaultStatus } = await import('../services/MemoryVault.js');
      res.json({ ok: true, ...(await vaultStatus()) });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) });
    }
  });
  app.post('/api/vault/remember', async (req, res) => {
    try {
      const { remember } = await import('../services/MemoryVault.js');
      const stored = await remember({ category: req.body?.category, content: req.body?.content, source: req.body?.source || 'api' });
      if (!stored) return res.json({ ok: true, kept: false, note: 'too thin to keep — the vault stores useful knowledge, not every sentence' });
      res.json({ ok: true, kept: true, id: stored.id, category: stored.category });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) });
    }
  });

  // ── market (status only — no secrets) ────────────────────────────
  app.get('/api/market/status', async (req, res) => {
    try {
      const { marketStatus } = await import('../services/JexiMarketProvider.js');
      res.json({ ok: true, ...marketStatus() });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) });
    }
  });

  // ── reasoning health ─────────────────────────────────────────────
  app.get('/api/reasoning/health', async (req, res) => {
    try {
      const { reasoningHealth } = await import('../services/ReasoningEngine.js');
      const h = await reasoningHealth();
      const safe = Object.fromEntries(Object.entries(h.providers || {}).map(([k, v]) => [k, { ok: !!v.ok, ms: v.ms ?? null, error: v.error || null, models: Array.isArray(v.models) ? v.models.slice(0, 10) : undefined }]));
      res.json({ ok: true, ladder: h.ladder, providers: safe });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) });
    }
  });

  // ── scheduler ────────────────────────────────────────────────────
  app.get('/api/scheduler/status', async (req, res) => {
    try {
      const { schedulerStatus } = await import('../services/Scheduler.js');
      res.json({ ok: true, status: schedulerStatus(req.query.missionId || null) });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) });
    }
  });
  app.post('/api/scheduler/control', async (req, res) => {
    try {
      const { pause, resume, cancel } = await import('../services/Scheduler.js');
      const { missionId, action } = req.body || {};
      if (!missionId || !['pause', 'resume', 'cancel'].includes(action)) {
        return res.status(400).json({ ok: false, error: 'needs { missionId, action: pause|resume|cancel }' });
      }
      const out = action === 'pause' ? pause(missionId) : action === 'resume' ? resume(missionId) : cancel(missionId);
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) });
    }
  });

  // ── persona (public only) ────────────────────────────────────────
  app.get('/api/persona', async (req, res) => {
    try {
      const { publicPersona } = await import('../services/UserProfile.js');
      res.json({ ok: true, ...publicPersona() });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) });
    }
  });

  // ── self-improvement ledger (read-only) ──────────────────────────
  app.get('/api/improve/anomalies', async (req, res) => {
    try {
      const [{ recent }, { scanAnomalies }] = await Promise.all([
        import('../services/Observer.js'),
        import('../services/SelfImprovement.js'),
      ]);
      res.json({ ok: true, anomalies: scanAnomalies(recent({ limit: 200 })) });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) });
    }
  });
  app.get('/api/improve/proposals', async (req, res) => {
    try {
      const { listProposals } = await import('../services/SelfImprovement.js');
      res.json({ ok: true, proposals: listProposals() });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) });
    }
  });
}
