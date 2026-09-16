/* brain.js — the console's REAL client for the JEXI OS brain.
   No mocks: every function talks to the deployed Render brain.

   - bus          live event pub/sub (feeds <EventStream /> — boot lines,
                  health heartbeats, chat pipeline logs, data loads)
   - brainGet/Post  JSON calls with timeout, session + tz headers
   - wakeBrain    auto-boot loop for Render cold starts (~50s), used by
                  <BootScreen /> so the server boots by itself on open
   - runSelfTest  the auto test question through POST /api/chat (NDJSON)
   - AUTO_TEST    handshake so the boot self-test lands visibly in <ChatView />
*/

import { getBackendUrl, getSessionId } from '../utils/helpers';

export const AUTO_TEST_QUESTION = 'Reply with exactly: JEXI BRAIN ONLINE';
const AUTO_TEST_KEY = 'jexi_autotest_pending';

/* ── live event bus ─────────────────────────────────────────────────────
   One event shape for the whole console: {id, ts, chip, who, msg, tone}.
   chip: SYS | AGENT | TOOL | NET | OK | WARN  (maps to the .chip styles). */
const listeners = new Set();
let seq = 0;

export function subscribeBus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitEvent({ chip = 'SYS', who = 'Console', msg = '', tone = '' }) {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' : '') + n;
  const evt = {
    id: ++seq,
    ts: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
    chip, who, msg, tone,
  };
  listeners.forEach((fn) => { try { fn(evt); } catch { /* never break a view */ } });
  return evt;
}

export const busCount = () => seq;

/* ── fetch helpers ────────────────────────────────────────────────────── */
async function brainFetch(path, { method = 'GET', body, timeoutMs = 20000 } = {}) {
  const base = getBackendUrl();
  if (!base) throw new Error('No brain configured — set the Server address in the sidebar.');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const headers = { 'x-jexi-session': getSessionId() };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${path}`, {
      method, headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export const brainGet = (path, timeoutMs) => brainFetch(path, { timeoutMs });
export const brainPost = (path, body, timeoutMs) => brainFetch(path, { method: 'POST', body, timeoutMs });

/* ── auto-boot: wake the brain (Render free tier sleeps ~50s) ─────────── */
export async function wakeBrain({ attempts = 25, gapMs = 4000, onAttempt } = {}) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const h = await brainGet('/api/health', 12000);
      if (h && h.ok) return h;
    } catch { /* still waking — keep going */ }
    if (onAttempt) onAttempt(i, attempts);
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return null;
}

/* ── self-test: one real question through the live /api/chat NDJSON ─────
   Returns {ok, answer, logs} — the same events <ChatView /> renders. */
export async function runSelfTest({ onLog } = {}) {
  const base = getBackendUrl();
  if (!base) throw new Error('No brain configured');
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-jexi-session': getSessionId() },
    body: JSON.stringify({ query: AUTO_TEST_QUESTION }),
  });
  if (!res.ok || !res.body) throw new Error(`Brain replied HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let answer = '';
  let success = true;
  const logs = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'log' && ev.message) {
        const l = `${ev.agent ? `${ev.agent}: ` : ''}${ev.message}`;
        logs.push(l);
        if (onLog) onLog(l);
      } else if (ev.type === 'stream' && ev.text) {
        answer += ev.text;
      } else if (ev.type === 'done') {
        if (ev.summary && ev.summary.length >= answer.length) answer = ev.summary;
        success = ev.success !== false;
      }
    }
  }
  return { ok: success && !!answer, answer, logs };
}

/* ── boot → Chat handshake ──────────────────────────────────────────────
   <BootScreen /> arms it after a passing self-test; <ChatView /> consumes
   it on mount and re-runs the same question live so the owner SEES the
   real conversation (user bubble, pipeline logs, streamed answer). */
export const armAutoTest = () => {
  try { sessionStorage.setItem(AUTO_TEST_KEY, '1'); } catch { /* private mode */ }
};
export const consumeAutoTest = () => {
  try {
    const v = sessionStorage.getItem(AUTO_TEST_KEY);
    if (v) sessionStorage.removeItem(AUTO_TEST_KEY);
    return !!v;
  } catch { return false; }
};

/* ── shared formatters ────────────────────────────────────────────────── */
export const fmtUptime = (s) => {
  const n = Math.max(0, Math.floor(Number(s) || 0));
  const p = (x) => (x < 10 ? '0' : '') + x;
  return `${p(Math.floor(n / 3600))}:${p(Math.floor(n / 60) % 60)}:${p(n % 60)}`;
};

/* One parallel sweep of every endpoint the console views run on.
   Called by <BootScreen /> after wake; each view also refetches on mount,
   so this bootstraps the sidebar counts + HUD with REAL numbers. */
export async function loadFleet() {
  const safe = async (path, timeoutMs = 15000) => {
    try { return { data: await brainGet(path, timeoutMs), ok: true }; }
    catch (e) { return { data: null, ok: false, error: (e && e.message) || 'failed' }; }
  };
  const [health, team, agents, coverage, plugins, connectors, mcpStatus, mcpServers, scheduler, processes, context, active] = await Promise.all([
    safe('/api/health', 12000),
    safe('/api/team'),
    safe('/api/agents/definitions'),
    safe('/api/agents/coverage'),
    safe('/api/plugins'),
    safe('/api/connectors'),
    safe('/api/mcp/status'),
    safe('/api/mcp/servers'),
    safe('/api/scheduler/jobs'),
    safe('/api/processes'),
    safe('/api/context'),
    safe('/api/providers/active'),
  ]);
  const fleet = {
    health: health.data, team: team.data, agents: agents.data, coverage: coverage.data,
    plugins: plugins.data, connectors: connectors.data, mcpStatus: mcpStatus.data,
    mcpServers: mcpServers.data, scheduler: scheduler.data, processes: processes.data,
    context: context.data, active: active.data,
    errors: [team, agents, plugins, connectors, mcpServers, scheduler].filter((x) => !x.ok).map((x) => x.error),
  };
  emitEvent({
    chip: 'OK', who: 'Fleet',
    msg: `loaded · ${(fleet.team?.team || []).length} teammates · ${fleet.agents?.count ?? 0} agent contracts · ${(fleet.plugins?.plugins || []).length} plugins · ${(fleet.connectors?.connectors || []).length} connectors`,
    tone: 'var(--jcx-up)',
  });
  return fleet;
}
