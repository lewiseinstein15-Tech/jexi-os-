/**
 * JEXI OS — DSH / UI API surface that was implemented in services but never
 * mounted on Express. Every handler here is a thin JSON adapter over an
 * existing service (no new product logic).
 *
 * Mounted from index.js via mountSurface(app, ctx).
 */

import axios from 'axios';
import { BRAND, brandIdentity } from '../services/Brand.js';
import { retentionStatus } from '../services/OutputRetention.js';
import { webSearchProviderStatus } from '../services/WebSearchProviders.js';
import { bundleStatus } from '../services/BundleBase.js';
import { pluginInventory } from '../services/PluginInventory.js';
import { listPlugins as listRuntimePlugins } from '../services/PluginAgent.js';
import { permissionsStatus, setPermissionPreset } from '../services/PermissionPresets.js';
import { personaStatus } from '../services/PersonaManager.js';
import { scheduleRuntimeStatus } from '../services/ScheduleRuntime.js';
import { hostStatus, gatewayStatus } from '../services/HostStatus.js';
import { sessionPersistenceStatus } from '../services/SessionPersistenceSqlite.js';
import { hookBridgeStatus } from '../services/HookBridges.js';
import { mcpServerStatus } from '../services/McpClient.js';
import { architectureSnapshot } from '../services/ArchitectureViews.js';
import { listRuns, getRun } from '../services/TaskGraph.js';
import { typertRegistryStatus } from '../services/TypingGenerator.js';
import { localeStatus } from '../services/Locale.js';
import { hmrStatus } from '../services/ClientHmr.js';
import { browseDirectories, directoryPickerStatus } from '../services/DirectoryPicker.js';
import { configStatus, reloadConfig } from '../services/ConfigReload.js';
import { remoteAgentsStatus, listRemoteAgents } from '../services/RemoteAgents.js';
import { tmuxStatus } from '../services/TmuxContext.js';
import { subagentProviderStatus } from '../services/SubagentProviders.js';
import { workerBootstrapSelfCheck } from '../services/CodeRuntimeBootstrap.js';
import { anonymousUserId } from '../services/AnonymousId.js';
import { listCommands } from '../services/CommandRegistry.js';
import { invariantStatus, checkConversationInvariants } from '../services/SessionInvariants.js';
import { telemetryStats, readTelemetry } from '../services/Telemetry.js';
import { listSessionCheckpoints } from '../services/SessionCheckpoints.js';
import { listSpills, spillStats } from '../services/SpillStore.js';
import { settingsFileStore } from '../services/SettingsFile.js';
import { cordisInspectStatus, cordisInspectList } from '../services/CordisInspect.js';
import { cordisRunnerStatus } from '../services/CordisRunner.js';
import { listProjectCapsules } from '../services/ProjectCapsules.js';
import {
  querySessionLog, exportSessionLog, querySessionSqlite, searchSessions,
} from '../services/SessionQuery.js';
import {
  listConversations, loadConversationEvents, deleteConversation,
  forkConversation, searchConversations, exportConversation,
} from '../services/SessionConversations.js';
import { setStoredTitle } from '../services/SessionTitles.js';
import { buildTrace } from '../services/SessionTrace.js';
import { compactNow, compactionStatus } from '../services/CompactionEngine.js';
import {
  enqueueGoal, listJobs, getJob, answerJob, subscribe as subscribeGoal,
} from '../services/GoalJobQueue.js';
import { discoverySummary, listSkillCatalog, getSkillBody, invalidateSkillCache } from '../services/SkillDiscovery.js';
import { listMarketplace, installSkill, uninstallSkill, marketplaceStats } from '../services/SkillMarketplace.js';
import { workspaceEntityStatus, initWorkspaceEntity } from '../services/WorkspaceEntity.js';
import { getVapidPublicKey, addSubscription, recordPushDiag, listPushDiag } from '../services/PushManager.js';
import { addFcmToken, fcmStatus } from '../services/FcmManager.js';
import { WORKSPACE_DIR } from '../config.js';

const GITHUB_LATEST = 'https://api.github.com/repos/lewiseinstein15-Tech/jexi-os-/releases/latest';

function jsonOk(res, body) {
  res.json(body && typeof body === 'object' ? body : { ok: true });
}

function jsonErr(res, status, error) {
  res.status(status).json({ ok: false, error: String(error || 'error') });
}

/** Latest GitHub release tag (used by the APK update banner + Settings). */
async function latestRelease() {
  const upstream = await axios.get(GITHUB_LATEST, {
    timeout: 12000,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'JEXI-OS-Update/1.0',
    },
  });
  const data = upstream.data || {};
  const tag = String(data.tag_name || '');
  const m = tag.match(/(\d+)/);
  return {
    ok: true,
    tag,
    tag_name: tag,
    number: m ? parseInt(m[1], 10) : 0,
    name: data.name || '',
    notes: data.body || data.name || '',
    published_at: data.published_at || null,
    date: data.published_at || null,
    html_url: data.html_url || '',
  };
}

export function mountSurface(app, ctx = {}) {
  const {
    publicDir = null,
    openPaths = [],
    keyLocked = false,
    allowUnlocked = false,
    scheduler = null,
  } = ctx;

  /* ---------- update / identity / brand ---------- */
  app.get('/api/update/version', async (req, res) => {
    try { jsonOk(res, await latestRelease()); }
    catch (e) {
      // Always 200 so Settings / the APK banner / the gauntlet stay honest
      // when GitHub is unreachable (rate-limit, TLS intercept, offline).
      jsonOk(res, { ok: false, tag: '', tag_name: '', number: 0, error: e.message || 'Could not reach GitHub releases' });
    }
  });

  app.get('/api/brand', (req, res) => {
    jsonOk(res, { ok: true, ...BRAND, identity: brandIdentity() });
  });

  app.get('/api/identity/id', (req, res) => {
    jsonOk(res, { ok: true, id: anonymousUserId() });
  });

  app.get('/api/retention', (req, res) => jsonOk(res, retentionStatus()));
  app.get('/api/web/providers', (req, res) => jsonOk(res, { ok: true, ...webSearchProviderStatus() }));
  app.get('/api/bundles', (req, res) => jsonOk(res, { ok: true, ...bundleStatus() }));

  /* ---------- plugins / permissions / personas ---------- */
  app.get('/api/plugins/inventory', (req, res) => jsonOk(res, pluginInventory()));
  app.get('/api/plugins/runtime', (req, res) => {
    jsonOk(res, { ok: true, plugins: listRuntimePlugins() });
  });
  app.get('/api/permissions', (req, res) => {
    jsonOk(res, permissionsStatus(req.headers['x-jexi-session'] || 'default'));
  });
  app.post('/api/permissions', (req, res) => {
    try {
      const convId = req.headers['x-jexi-session'] || 'default';
      jsonOk(res, setPermissionPreset(convId, req.body && req.body.preset));
    } catch (e) { jsonErr(res, 400, e.message); }
  });
  app.get('/api/personas', (req, res) => jsonOk(res, personaStatus()));

  /* ---------- host / gateway / config ---------- */
  app.get('/api/host', (req, res) => jsonOk(res, hostStatus({ publicDir })));
  app.get('/api/gateway', (req, res) => jsonOk(res, gatewayStatus({
    openPaths, keyLocked, allowUnlocked,
  })));
  app.get('/api/config', (req, res) => jsonOk(res, { ok: true, ...configStatus() }));
  app.post('/api/config/reload', (req, res) => jsonOk(res, { ok: true, ...reloadConfig() }));
  app.get('/api/locale', (req, res) => jsonOk(res, { ok: true, ...localeStatus() }));
  app.get('/api/hmr', (req, res) => jsonOk(res, { ok: true, ...hmrStatus() }));
  app.get('/api/directories', (req, res) => {
    const base = req.query.base || undefined;
    jsonOk(res, { ok: true, ...directoryPickerStatus(), ...browseDirectories({ base }) });
  });
  app.get('/api/schedule/runtime', (req, res) => jsonOk(res, scheduleRuntimeStatus(scheduler)));
  app.get('/api/session-persistence', (req, res) => jsonOk(res, { ok: true, ...sessionPersistenceStatus() }));
  app.get('/api/hooks/bridges', (req, res) => jsonOk(res, { ok: true, ...hookBridgeStatus() }));
  app.get('/api/mcp/servers', (req, res) => jsonOk(res, { ok: true, ...mcpServerStatus() }));
  /* Ultimate Architecture Upgrade — observability (§20). Read-only views that
     feed the existing chat/Workshop surfaces. No new UI buttons (Lewis's rule). */
  app.get('/api/architecture', (req, res) => jsonOk(res, { ok: true, ...architectureSnapshot() }));
  app.get('/api/architecture/runs', (req, res) => jsonOk(res, { ok: true, runs: listRuns() }));
  app.get('/api/architecture/runs/:id', (req, res) => {
    const run = getRun(req.params.id);
    if (!run) return jsonErr(res, 404, `run '${req.params.id}' not found`);
    jsonOk(res, { ok: true, run });
  });
  app.get('/api/typert/registry', (req, res) => jsonOk(res, { ok: true, ...typertRegistryStatus() }));
  app.get('/api/remotes', (req, res) => jsonOk(res, { ok: true, ...remoteAgentsStatus(), remotes: listRemoteAgents() }));
  app.get('/api/tmux', (req, res) => jsonOk(res, { ok: true, ...tmuxStatus() }));
  app.get('/api/report/channels', (req, res) => jsonOk(res, { ok: true, channels: ['in-app', 'email', 'push'] }));
  app.get('/api/subagent/providers', (req, res) => jsonOk(res, { ok: true, ...subagentProviderStatus() }));
  app.get('/api/code-runtime/bootstrap', (req, res) => jsonOk(res, { ok: true, checks: workerBootstrapSelfCheck() }));
  app.get('/api/commands', (req, res) => jsonOk(res, { ok: true, commands: listCommands() }));
  app.get('/api/invariants', (req, res) => {
    const conv = req.query.conv || req.headers['x-jexi-session'];
    jsonOk(res, conv ? checkConversationInvariants(conv) : invariantStatus());
  });
  app.get('/api/telemetry', (req, res) => {
    jsonOk(res, { ok: true, stats: telemetryStats(), recent: readTelemetry(Number(req.query.limit) || 50) });
  });
  app.get('/api/checkpoints', (req, res) => {
    jsonOk(res, { ok: true, checkpoints: listSessionCheckpoints(req.query.conv || null) });
  });
  app.get('/api/spills', (req, res) => {
    const owner = req.query.owner || req.headers['x-jexi-session'] || '';
    jsonOk(res, { ok: true, spills: listSpills(owner), stats: spillStats(owner) });
  });
  app.get('/api/storage', (req, res) => {
    jsonOk(res, { ok: true, backends: ['json', 'sqlite'], note: 'StorageHub units live under DATA_DIR' });
  });
  app.get('/api/settings/file', (req, res) => {
    try {
      const store = settingsFileStore();
      jsonOk(res, { ok: true, settings: store.all ? store.all() : {} });
    } catch (e) {
      jsonOk(res, { ok: true, settings: {}, note: e.message });
    }
  });
  app.get('/api/cordis/inspect', (req, res) => jsonOk(res, { ok: true, ...cordisInspectStatus(), providers: cordisInspectList() }));
  app.get('/api/cordis/runner', (req, res) => jsonOk(res, { ok: true, ...cordisRunnerStatus() }));

  /* ---------- projects / workspace entity ---------- */
  app.get('/api/projects', (req, res) => {
    jsonOk(res, { ok: true, projects: listProjectCapsules() });
  });
  app.get('/api/workspace/entity', (req, res) => {
    jsonOk(res, { ok: true, ...workspaceEntityStatus(WORKSPACE_DIR) });
  });
  app.post('/api/workspace/entity', (req, res) => {
    jsonOk(res, { ok: true, ...initWorkspaceEntity(WORKSPACE_DIR, req.body || {}) });
  });

  /* ---------- conversations (History view) ---------- */
  app.get('/api/conversations/search', (req, res) => {
    jsonOk(res, { ok: true, results: searchConversations(req.query.q || '', { limit: Number(req.query.limit) || 10 }) });
  });
  app.get('/api/conversations', (req, res) => {
    jsonOk(res, { ok: true, conversations: listConversations() });
  });
  app.get('/api/conversations/:id', (req, res) => {
    const events = loadConversationEvents(req.params.id, Number(req.query.limit) || 500);
    if (!events.length) return jsonErr(res, 404, 'conversation not found');
    jsonOk(res, { ok: true, id: req.params.id, events });
  });
  app.delete('/api/conversations/:id', (req, res) => jsonOk(res, deleteConversation(req.params.id)));
  app.post('/api/conversations/:id/fork', (req, res) => jsonOk(res, forkConversation(req.params.id, req.body && req.body.id)));
  app.post('/api/conversations/:id/rename', (req, res) => {
    const title = String((req.body && req.body.title) || '').trim();
    if (!title) return jsonErr(res, 400, 'title required');
    setStoredTitle(req.params.id, title, 'user');
    jsonOk(res, { ok: true, id: req.params.id, title });
  });
  app.get('/api/conversations/:id/export', (req, res) => jsonOk(res, exportConversation(req.params.id, req.query.format || 'jsonl')));
  app.get('/api/conversations/:id/trace', (req, res) => jsonOk(res, { ok: true, ...buildTrace(req.params.id) }));
  app.get('/api/conversations/:id/compact/status', (req, res) => jsonOk(res, { ok: true, ...compactionStatus(req.params.id) }));
  app.post('/api/conversations/:id/compact', async (req, res) => {
    try {
      const result = await compactNow(req.params.id, { force: true });
      jsonOk(res, { ok: true, ...(result || { compacted: false }) });
    } catch (e) { jsonErr(res, 500, e.message); }
  });

  /* ---------- session-query (search BEFORE :conv) ---------- */
  app.get('/api/session-query/search', (req, res) => {
    jsonOk(res, searchSessions(req.query.q || '', { limit: Number(req.query.limit) || 8 }));
  });
  app.get('/api/session-query/:conv/export', (req, res) => jsonOk(res, exportSessionLog(req.params.conv)));
  app.get('/api/session-query/:conv/sqlite', (req, res) => {
    jsonOk(res, querySessionSqlite(req.params.conv, { kind: req.query.kind || null, limit: Number(req.query.limit) || 100 }));
  });
  app.get('/api/session-query/:conv', (req, res) => {
    jsonOk(res, querySessionLog(req.params.conv, {
      kind: req.query.kind || null,
      role: req.query.role || null,
      limit: Number(req.query.limit) || 500,
      afterSeq: req.query.afterSeq != null ? Number(req.query.afterSeq) : null,
    }));
  });

  /* ---------- goals (durable background jobs) ---------- */
  app.get('/api/goals', (req, res) => {
    jsonOk(res, { ok: true, goals: listJobs().filter((j) => (j.kind || 'goal') === 'goal') });
  });
  app.post('/api/goals', (req, res) => {
    const goal = String((req.body && (req.body.goal || req.body.query)) || '').trim();
    if (!goal) return jsonErr(res, 400, 'No goal provided');
    const session = req.headers['x-jexi-session'] || 'default';
    const autonomy = String((req.body && req.body.autonomy) || 'ask').toLowerCase();
    const { id } = enqueueGoal({ goal, session, autonomy, mode: (req.body && req.body.mode) || 'agent' });
    res.status(202).json({ ok: true, jobId: id, id });
  });
  app.get('/api/goals/:id', (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return jsonErr(res, 404, 'job not found');
    jsonOk(res, { ok: true, goal: job });
  });
  app.post('/api/goals/:id/info', (req, res) => {
    jsonOk(res, answerJob(req.params.id, (req.body && req.body.answer) || ''));
  });
  app.get('/api/goals/:id/stream', (req, res) => {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (ev) => { try { res.write(JSON.stringify(ev) + '\n'); } catch { /* closed */ } };
    const heartbeat = setInterval(() => { try { res.write('{"type":"heartbeat"}\n'); } catch { /* closed */ } }, 10000);
    const sub = subscribeGoal(req.params.id, send);
    if (!sub.ok) {
      clearInterval(heartbeat);
      return res.status(404).json({ ok: false, error: sub.error || 'job not found' });
    }
    if (sub.finished) {
      clearInterval(heartbeat);
      return res.end();
    }
    req.on('close', () => {
      clearInterval(heartbeat);
      if (typeof sub.unsubscribe === 'function') sub.unsubscribe();
    });
  });

  /* ---------- skills discovery / marketplace ---------- */
  app.get('/api/skills/discovery', (req, res) => {
    jsonOk(res, { ok: true, ...discoverySummary(), skills: listSkillCatalog() });
  });
  app.post('/api/skills/discovery/invalidate', (req, res) => {
    invalidateSkillCache();
    jsonOk(res, { ok: true });
  });
  app.get('/api/skills/discovery/:id', (req, res) => {
    const body = getSkillBody(req.params.id);
    if (!body) return jsonErr(res, 404, 'skill not found');
    jsonOk(res, { ok: true, skill: body });
  });
  app.get('/api/skills/marketplace', (req, res) => {
    jsonOk(res, { ok: true, skills: listMarketplace(), ...marketplaceStats() });
  });
  app.post('/api/skills/marketplace/:id/install', (req, res) => {
    jsonOk(res, installSkill(req.params.id));
  });
  app.delete('/api/skills/marketplace/:id', (req, res) => {
    jsonOk(res, uninstallSkill(req.params.id));
  });

  /* ---------- push / FCM ---------- */
  app.get('/api/push/vapid-key', (req, res) => {
    jsonOk(res, { ok: true, key: getVapidPublicKey() });
  });
  app.post('/api/push/subscribe', (req, res) => {
    jsonOk(res, addSubscription(req.body || {}));
  });
  app.get('/api/push/diag', (req, res) => {
    jsonOk(res, { ok: true, diag: listPushDiag() });
  });
  app.post('/api/push/diag', (req, res) => {
    jsonOk(res, recordPushDiag(req.body || {}));
  });
  app.get('/api/push/fcm-status', (req, res) => jsonOk(res, { ok: true, ...fcmStatus() }));
  app.post('/api/push/fcm-token', (req, res) => {
    jsonOk(res, addFcmToken((req.body && req.body.token) || '', (req.body && req.body.ua) || ''));
  });

  /* alias used by older screens */
  app.get('/api/sessions', (req, res) => {
    jsonOk(res, { ok: true, conversations: listConversations() });
  });
}
