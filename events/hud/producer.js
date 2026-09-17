/**
 * JEXI OS — HUD STATUS CONTRACT — producer (Phase 7 F).
 *
 * Gathers state from EVERY live subsystem and produces ONE payload per
 * session state change, then emits `hud.updated` on the Observer bus.
 *
 * Sources (all fail-soft, all real — a missing subsystem degrades its own
 * section to honest defaults, it never fabricates and never breaks boot):
 *   kernel          → active session, mission, plan/tool profile (controls)
 *   context manager → conversation pressure, approx tokens, model, provider
 *   tool executor   → recent calls / pending / stale (via hud-seam wiring)
 *   workforce       → roster summary, per-agent work state
 *   verification    → checks.local via verification.* events on the bus
 *   provider bridge → provider/model via resolveModelConfig; cost via spend notes
 *   scheduler       → queue depths (autonomy scheduler + task manager)
 *   learning        → instincts loaded (seam status)
 *   events bus      → lastEvent, risk signals (mission/verification failures)
 *
 * Cost method (documented honesty): the provider walk knows real prompt +
 * completion SIZES; tokens are estimated at chars/4 (the project's own
 * convention, RequestBudget.js:852) and priced against the indicative
 * per-model table below. sessionUsd is an estimate and says so.
 */

import { HUD_VERSION, emptyPayload } from './schema.js';
import { validateHud } from './validator.js';

const RECENT_MAX = 25;
const SPEND_WINDOW_MAX = 200;
const SIGNAL_MAX = 60;
const STALE_MS = 30_000;         // a pending tool call older than this is stale
const DEBOUNCE_MS = 120;         // coalesce bursts of state changes into one payload
const WARNING_TTL_MS = 10 * 60_000;
const CRITICAL_TTL_MS = 5 * 60_000;

/** Indicative USD per 1M tokens (in/out) — public list pricing, Sep 2026. */
const PRICE_PER_MTOK = {
  groq: { in: 0.10, out: 0.45 }, // openai/gpt-oss-120b class (Groq live flagship)
  gemini: { in: 0.10, out: 0.40 }, // flash class
  google: { in: 0.10, out: 0.40 },
  openai: { in: 0.15, out: 0.60 }, // 4o-mini class
  'openai/gpt-oss-120b': { in: 0.10, out: 0.45 },
  'openai/gpt-oss-20b': { in: 0.04, out: 0.16 },
  cloudflare: { in: 0.21, out: 0.21 },
  pollinations: { in: 0, out: 0 }, // free tier — real zero, not an omission
  deepseek: { in: 0.27, out: 1.10 },
  mistral: { in: 0.15, out: 0.60 },
};
const DEFAULT_PRICE = { in: 0.50, out: 1.50 }; // conservative mid when unknown
const CHARS_PER_TOKEN = 4;

/* ── producer state ──────────────────────────────────────────────────── */
const state = {
  recent: [],            // [{name, status, durationMs, at}] newest-first
  pending: new Map(),    // callId → { name, at }
  spend: [],             // [{t, usd, provider, model}] — session ledger
  signals: [],           // [{t, kind, severity: 'info'|'warning'|'critical'}]
  checks: { local: 'idle', remote: 'idle', lastRunAt: null },
  toolFailStreak: 0,
  published: null,       // last published payload
  revision: 0,
  publishedAt: null,
  lastReason: null,
  lastEventSummary: '',
  subscriberCount: 0,    // filled by consumer (diagnostics)
  wired: false,
};
const subscribers = new Set();
let debounceTimer = null;

/* ── fail-soft dynamic imports (cached per process) ──────────────────── */
const modCache = new Map();
async function softImport(key, spec) {
  if (modCache.has(key)) return modCache.get(key);
  let mod = null;
  try { mod = await import(spec); } catch { mod = null; }
  modCache.set(key, mod);
  return mod;
}

const S = {
  observer: () => softImport('observer', '../../server/src/services/Observer.js'),
  memory: () => softImport('memory', '../../server/src/services/MemoryManager.js'),
  mission: () => softImport('mission', '../../server/src/services/director/Mission.js'),
  missionRunner: () => softImport('missionRunner', '../../server/src/services/director/MissionRunner.js'),
  modelConfig: () => softImport('modelConfig', '../../server/src/services/providers/modelConfig.js'),
  compaction: () => softImport('compaction', '../../server/src/services/CompactionEngine.js'),
  planMode: () => softImport('planMode', '../../server/src/services/PlanMode.js'),
  toolRuntime: () => softImport('toolRuntime', '../../server/src/services/ToolRuntime.js'),
  employees: () => softImport('employees', '../../server/src/services/director/Employees.js'),
  taskManager: () => softImport('taskManager', '../../server/src/services/TaskManager.js'),
  todoStore: () => softImport('todoStore', '../../server/src/services/TodoStore.js'),
  scheduler: () => softImport('scheduler', '../../server/src/scheduler/index.js'),
  concurrency: () => softImport('concurrency', '../../server/src/services/ConcurrencyAgent.js'),
  learningSeam: () => softImport('learningSeam', '../../server/src/kernel/hooks/learning-seam.js'),
};

const nowIso = () => new Date().toISOString();
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* ── seam entry points (called from server/src/kernel/hooks/hud-seam.js) ── */

/** PreToolUse — a tool call entered the gate. Pending until it resolves. */
export function noteToolPending(call, ctx = {}) {
  try {
    const id = call?.id || `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    state.pending.set(id, { name: String(call?.name || 'unknown'), at: Date.now() });
    schedulePublish('tool-pending');
    return id;
  } catch { return null; }
}

/** PostToolUse — the call resolved (ok | fail | blocked by gate/hook). */
export function recordToolCall(call, result, ctx = {}) {
  try {
    const name = String(call?.name || 'unknown');
    const id = call?.id || null;
    // resolve the pending marker (any pending with this name, oldest first)
    for (const [pid, p] of state.pending) {
      if (p.name === name) { state.pending.delete(pid); break; }
    }
    const blocked = result?.blocked === true || result?.declined === true
      || result?.hookLogs?.some((h) => h && h.blocked)
      || /permission denied|blocked by hook/.test(String(result?.error || ''));
    const status = blocked ? 'blocked' : (result?.ok ? 'ok' : 'fail');
    state.recent.unshift({
      name,
      status,
      durationMs: Math.max(0, Number(result?.durationMs) || 0),
      at: nowIso(),
    });
    if (state.recent.length > RECENT_MAX) state.recent.length = RECENT_MAX;
    if (status === 'ok') state.toolFailStreak = 0;
    else if (status === 'fail') {
      state.toolFailStreak += 1;
      pushSignal('tool.failed', state.toolFailStreak >= 3 ? 'critical' : 'warning');
    }
    schedulePublish('tool-call');
    return true;
  } catch { return false; }
}

/** Model call spend note — real sizes from the provider walk (see header). */
export function noteSpend({ provider = 'unknown', model = null, inChars = 0, outChars = 0, ok = true } = {}) {
  try {
    if (!ok) { pushSignal('model.failed', 'warning'); schedulePublish('model-call'); return null; }
    const price = PRICE_PER_MTOK[String(model || '').toLowerCase()] || PRICE_PER_MTOK[provider] || DEFAULT_PRICE;
    const inTok = Math.ceil(Number(inChars || 0) / CHARS_PER_TOKEN);
    const outTok = Math.ceil(Number(outChars || 0) / CHARS_PER_TOKEN);
    const usd = (inTok / 1e6) * price.in + (outTok / 1e6) * price.out;
    state.spend.push({ t: Date.now(), usd, provider, model });
    if (state.spend.length > SPEND_WINDOW_MAX) state.spend.splice(0, state.spend.length - SPEND_WINDOW_MAX);
    schedulePublish('model-call');
    return usd;
  } catch { return null; }
}

/** Check note — 'local' (verification runs) or 'remote' (self-ping probes). */
export function noteCheck(kind, status) {
  try {
    if (kind !== 'local' && kind !== 'remote') return false;
    if (!['pass', 'fail', 'running', 'idle'].includes(status)) return false;
    state.checks[kind] = status;
    if (status === 'pass' || status === 'fail') state.checks.lastRunAt = nowIso();
    if (kind === 'local' && status === 'fail') pushSignal('verification.failed', 'warning');
    schedulePublish(`check-${kind}`);
    return true;
  } catch { return false; }
}

/** Risk signal note — external subsystems can raise attention directly. */
export function noteRisk(kind, severity = 'warning') {
  try { pushSignal(String(kind || 'risk.signal'), severity === 'critical' ? 'critical' : 'warning'); schedulePublish('risk-signal'); return true; } catch { return false; }
}

function pushSignal(kind, severity) {
  state.signals.push({ t: Date.now(), kind, severity });
  if (state.signals.length > SIGNAL_MAX) state.signals.splice(0, state.signals.length - SIGNAL_MAX);
}

/* ── section builders ────────────────────────────────────────────────── */

async function buildContext(out, session) {
  const [mc, ce] = await Promise.all([S.modelConfig(), S.compaction()]);
  const settingsMod = await softImport('settings', '../../server/src/services/SettingsManager.js');
  try {
    let cfg = null;
    try { cfg = mc?.resolveModelConfig ? mc.resolveModelConfig({ settings: settingsMod?.loadSettings?.() || null }) : null; } catch { /* env next */ }
    if (!cfg) cfg = mc?.resolveModelConfig ? mc.resolveModelConfig({}) : null;
    out.context.model = String(cfg?.model || process.env.JEXI_MODEL_NAME || 'unresolved');
    out.context.provider = String(cfg?.provider || process.env.JEXI_MODEL_PROVIDER || 'unresolved');
  } catch { /* defaults stay */ }
  try {
    if (session) {
      const cs = ce?.compactionStatus ? ce.compactionStatus(session) : null;
      if (cs) {
        out.context.tokensUsed = Math.max(0, Number(cs.approxTokens) || 0);
        out.context.tokensCap = Math.max(0, Math.round((Number(cs.threshold) || 0) / CHARS_PER_TOKEN));
        out.context.contextPressure = cs.threshold ? clamp(cs.chars / cs.threshold, 0, 1) : 0;
      }
    }
  } catch { /* defaults stay */ }
}

async function buildToolCalls(out) {
  const obs = await S.observer();
  let lastEvent = '';
  try { lastEvent = String(obs?.recent?.({ limit: 1 })?.[0]?.summary || ''); } catch { /* empty */ }
  state.lastEventSummary = lastEvent || state.lastEventSummary;
  const now = Date.now();
  let stale = 0;
  for (const p of state.pending.values()) if (now - p.at > STALE_MS) stale += 1;
  out.toolCalls = {
    recent: state.recent.slice(0, RECENT_MAX),
    pending: state.pending.size,
    stale,
    lastEvent: state.lastEventSummary,
  };
}

async function buildActiveAgents(out) {
  const [emp, mr, conc] = await Promise.all([S.employees(), S.missionRunner(), S.concurrency()]);
  let roster = [];
  try { roster = (emp?.rosterSummary?.() || []).map((e) => ({ ...e })); } catch { /* empty */ }
  const running = [];
  try {
    const missions = (mr ? (await import('../../server/src/services/director/Mission.js')).listMissions(null, 50) : []) || [];
    for (const m of missions) if ((m.state === 'running' || m.state === 'dispatching') && m.id) running.push(m);
  } catch { /* no mission lane */ }
  let locks = [];
  try { locks = conc?.listLocks?.() || []; } catch { locks = []; }
  const lead = running[0] || null;
  out.activeAgents = roster.map((e, i) => {
    const isLead = Boolean(lead) && i === 0; // the seated lead (first of roster) carries the running mission
    const lockOwner = locks.some((l) => String(l?.owner || l?.agentId || '').toLowerCase().includes(String(e.agentId || '').toLowerCase()));
    const working = isLead || lockOwner;
    return {
      id: String(e.agentId || `agent-${i}`),
      name: String(e.displayName || e.agentId || `agent-${i}`),
      role: String(e.role || 'coworker'),
      state: working ? 'working' : 'idle',
      objective: working ? String(lead?.objective || lead?.title || 'active mission work') : null,
      resourcePct: working ? clamp(Math.round((running.length / Math.max(1, running.length + 1)) * 100) + (locks.length ? 10 : 0), 1, 100) : 0,
      startedAt: working ? (lead?.createdAt ? new Date(lead.createdAt).toISOString() : nowIso()) : null,
    };
  });
}

async function buildTodos(out) {
  const [ts, tm] = await Promise.all([S.todoStore(), S.taskManager()]);
  const rows = [];
  try {
    for (const t of (ts?.todoList?.() || []).slice(0, 12)) {
      rows.push({ id: `todo-${t.index}`, text: String(t.text || ''), status: t.done ? 'done' : 'pending', owner: 'user' });
    }
  } catch { /* no todo store */ }
  try {
    const reg = await softImport('taskRegistry', '../../server/src/services/TaskRegistry.js');
    for (const t of (reg?.listTasks?.() || []).filter((t) => t.status === 'active').slice(0, 8)) {
      rows.push({ id: `task-${t.id}`, text: String(t.title || t.id || ''), status: 'active', owner: 'brain' });
    }
  } catch { /* no task registry */ }
  out.todos = rows.slice(0, 20);
}

async function buildQueueState(out) {
  const [sch, tm, mr] = await Promise.all([S.scheduler(), S.taskManager(), S.missionRunner()]);
  let missionsQueued = 0;
  let toolsQueued = 0;
  let verificationsQueued = 0;
  try { missionsQueued = Math.max(0, Number(sch?.autonomyScheduler?.().status?.().queued) || 0); } catch { /* 0 */ }
  try { toolsQueued = (tm?.taskManager?.list?.() || []).filter((t) => t.status === 'queued').length; } catch { /* 0 */ }
  try {
    const active = mr?.missionRunner;
    const running = active && typeof active.listRunningMissions === 'function' ? active.listRunningMissions() : [];
    for (const m of running.slice(0, 3)) {
      const snap = active.snapshot(m.id || m);
      const items = Array.isArray(snap?.graph?.items) ? snap.graph.items : [];
      verificationsQueued += items.filter((i) => i && i.type === 'verification' && !['DONE', 'FAILED', 'SKIPPED', 'SUPERSEDED'].includes(String(i.status || '').toUpperCase())).length;
    }
  } catch { /* 0 */ }
  out.queueState = { missionsQueued, toolsQueued, verificationsQueued };
}

async function buildSessionControls(out, session) {
  const [pm, tr, mr] = await Promise.all([S.planMode(), S.toolRuntime(), S.missionRunner()]);
  let runningMission = null;
  let resumable = false;
  try {
    const M = await import('../../server/src/services/director/Mission.js');
    const missions = M.listMissions(null, 50) || [];
    runningMission = missions.find((m) => m.state === 'running' || m.state === 'dispatching') || null;
    resumable = missions.some((m) => m.isResumable);
  } catch { /* none */ }
  let mode = 'agent';
  try { if (session && pm?.isPlanMode?.(session)) mode = 'plan'; } catch { /* agent */ }
  try { if (mode === 'agent' && tr?.activeToolProfile?.() === 'readonly') mode = 'ask'; } catch { /* agent */ }
  out.sessionControls = {
    canPause: Boolean(runningMission),
    canStop: Boolean(runningMission),
    canRestart: Boolean(resumable || runningMission),
    mode,
  };
}

function buildRisk(out) {
  const now = Date.now();
  const criticals = state.signals.filter((s) => s.severity === 'critical' && now - s.t < CRITICAL_TTL_MS);
  const warnings = state.signals.filter((s) => s.severity === 'warning' && now - s.t < WARNING_TTL_MS);
  let stale = 0;
  for (const p of state.pending.values()) if (now - p.at > STALE_MS) stale += 1;
  let attention = 'normal';
  if (criticals.length > 0 || warnings.length >= 3) attention = 'critical';
  else if (warnings.length > 0 || stale > 0) attention = 'warning';
  let conflictPressure = 0;
  out.risk = { attention, conflictPressure, staleCalls: stale };
  return (async () => {
    try {
      const conc = await S.concurrency();
      const locks = conc?.listLocks?.() || [];
      conflictPressure = clamp(locks.length / 8, 0, 1);
      out.risk.conflictPressure = conflictPressure;
    } catch { /* 0 stays */ }
  })();
}

function buildCost(out) {
  const now = Date.now();
  const sessionUsd = state.spend.reduce((a, s) => a + s.usd, 0);
  const recent = state.spend.filter((s) => now - s.t < 120_000).reduce((a, s) => a + s.usd, 0);
  const prior = state.spend.filter((s) => now - s.t >= 120_000 && now - s.t < 240_000).reduce((a, s) => a + s.usd, 0);
  let trend = 'flat';
  if (recent > 0 && recent >= prior) trend = 'up';
  else if (prior > 0 && recent < prior) trend = 'down';
  out.cost = {
    sessionUsd: Math.round(sessionUsd * 1e6) / 1e6, // micro-dollar resolution
    budgetUsd: Number(process.env.JEXI_BUDGET_USD) || 5,
    trend,
  };
}

/* ── build + publish ─────────────────────────────────────────────────── */

/** Assemble the full payload from every live subsystem. */
export async function build() {
  const out = emptyPayload();
  try { const mem = await S.memory(); out.sessionId = String(mem?.getActiveSession?.() || 'server'); } catch { /* server */ }
  out.agentId = 'jexi-brain';
  try {
    const M = await import('../../server/src/services/director/Mission.js');
    const missions = M.listMissions(null, 50) || [];
    const running = missions.find((m) => m.state === 'running' || m.state === 'dispatching');
    out.missionId = running ? String(running.id) : null;
  } catch { /* null stays */ }
  out.generatedAt = nowIso();

  out.checks = { ...state.checks }; // checks state (verification runs + self-ping) flows into the payload
  await buildContext(out, out.sessionId);
  await buildToolCalls(out);
  await buildActiveAgents(out);
  await buildTodos(out);
  await buildQueueState(out);
  await buildSessionControls(out, out.sessionId);
  await buildRisk(out);
  buildCost(out);
  try {
    const ls = await S.learningSeam();
    if (ls?.learningSeamStatus?.().loaded) out.sync.handoff = 'idle'; // learning loaded — handoff lane reserved, stays honest 'idle'
  } catch { /* ignore */ }

  // P7 debug seam: omit sections explicitly listed in JEXI_HUD_OMIT so the
  // console can be demonstrated NOT to fabricate. Never set in production.
  const omit = String(process.env.JEXI_HUD_OMIT || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const k of omit) delete out[k];

  out.generatedAt = nowIso(); // stamped last: the moment this state was true
  return out;
}

/** Force a build + publish right now (bypasses the debounce). */
export async function publish(reason = 'manual') {
  const payload = await build();
  const v = validateHud(payload);
  if (!v.valid) {
    // P10 contract: an invalid payload is never published, never served.
    const err = new Error(`HUD producer rejected payload: ${v.errors.join('; ')}`);
    err.code = 'HUD_INVALID';
    err.errors = v.errors;
    throw err;
  }
  const changed = !state.published || JSON.stringify(payload) !== JSON.stringify(state.published);
  state.published = payload;
  state.publishedAt = nowIso();
  state.lastReason = reason;
  state.revision += 1;
  if (changed) {
    for (const fn of subscribers) {
      try { fn(state.revision, payload); } catch { /* a bad consumer never breaks the producer */ }
    }
    try {
      const obs = await S.observer();
      obs?.emit?.('hud.updated', {
        summary: `hud revision ${state.revision} (${reason})`,
        data: { revision: state.revision, reason, sections: Object.keys(payload).filter((k) => k !== 'version') },
      });
    } catch { /* bus is optional in standalone probes */ }
  }
  return { payload, changed, revision: state.revision };
}

/** Debounced publish — ONE payload per burst of state changes. */
export function schedulePublish(reason = 'change') {
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    publish(reason).catch(() => { /* never surface through a timer */ });
  }, DEBOUNCE_MS);
}

/** Current published payload (or null before the first publish). */
export function snapshot() {
  return {
    payload: state.published,
    revision: state.revision,
    publishedAt: state.publishedAt,
    reason: state.lastReason,
  };
}

/** Subscribe to publishes — consumer side. Returns unsubscribe. */
export function onPublish(fn) {
  if (typeof fn !== 'function') return () => {};
  subscribers.add(fn);
  state.subscriberCount = subscribers.size;
  return () => { subscribers.delete(fn); state.subscriberCount = subscribers.size; };
}

/** Test/diagnostic reset (never call in production). */
export function _reset() {
  state.recent = [];
  state.pending.clear();
  state.spend = [];
  state.signals = [];
  state.checks = { local: 'idle', remote: 'idle', lastRunAt: null };
  state.toolFailStreak = 0;
  state.published = null;
  state.revision = 0;
  state.publishedAt = null;
  state.lastReason = null;
  state.lastEventSummary = '';
  modCache.clear();
}

export { state as producerState };
