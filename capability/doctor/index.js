// Phase 11 Scope H — unified doctor for the Phase 11 subsystems.
//
// Aggregates REAL health probes (no hardcoded values):
//   codegraph-daemon (C) — live TCP handshake + status via DaemonClient
//   code-graph       (A) — store counts, last index time, coverage %,
//                            freshness vs newest git HEAD commit
//   reach            (E) — per-channel check() (real network probes)
//   mcp-servers      (G) — spawn each stdio server, initialize + tools/list
//
// This doctor is SCOPED to Phase 11 subsystems. It does NOT replace or shadow
// the Phase 7 G `/doctor` slash command (commands/doctor.command.js — node /
// providers / storage / workgraph / hud / observer / learning / mcp-registry /
// disk): that one stays the environment health entry point; this one is the
// Phase 11 capability-layer report and registers no command.
//
// Output shape:
//   { overall, healthy, timestamp, subsystems[], warnings[], errors[] }
//   subsystem: { name, status: ok|warn|off|error, message, detail?, lastUpdated? }

import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const STATUS_RANK = { ok: 0, warn: 1, off: 2, error: 3 };
const worst = (a, b) => (STATUS_RANK[a] >= STATUS_RANK[b] ? a : b);

function subsystem(name, status, message, detail = undefined, lastUpdated = undefined) {
  return { name, status, message, ...(detail !== undefined ? { detail } : {}), ...(lastUpdated ? { lastUpdated } : {}) };
}

/* ── Scope C — codegraph daemon ── */
async function checkDaemon(project) {
  const { DaemonClient } = await import(path.join(ROOT, 'kernel/daemon/client.js'));
  const started = Date.now();
  try {
    const client = await DaemonClient.open({ spawnIfDown: false });
    let st = null, gs = null;
    try { st = await client.status(); } catch { /* status optional */ }
    try { gs = await client.graphStatus(project); } catch { /* graph-status optional */ }
    const info = client.daemon || {};
    const uptimeS = st?.daemon?.uptimeMs != null ? Math.round(st.daemon.uptimeMs / 1000) : null;
    const roundTrip = Date.now() - started;
    try { client.socket?.end(); } catch { /* closing */ }
    return subsystem(
      'codegraph-daemon',
      'ok',
      `daemon running (pid ${info.pid ?? '?'}, build ${info.build ?? '?'}, uptime ${uptimeS != null ? `${uptimeS}s` : '?'} — handshake + status round-trip ${roundTrip}ms)`,
      { daemon: info, status: st, graphStatus: gs },
      new Date().toISOString(),
    );
  } catch (e) {
    const down = e?.code === 'DAEMON_DOWN' || /no live daemon|did not come up/i.test(String(e?.message));
    return subsystem(
      'codegraph-daemon',
      down ? 'off' : 'error',
      down
        ? 'daemon not running (DAEMON_DOWN) — start: node kernel/daemon/codegraph-daemon.js'
        : `daemon probe failed: ${String(e?.message || e).slice(0, 160)}`,
      { error: String(e?.message || e) },
      new Date().toISOString(),
    );
  }
}

/* ── Scope A — CBM code graph ── */
async function checkCodeGraph(project) {
  try {
    const { getStore, closeStore } = await import(path.join(ROOT, 'tools/domains/lsp/_graph.js'));
    const { handler: coverageHandler } = await import(path.join(ROOT, 'tools/domains/lsp/check-index-coverage.tool.js'));
    const store = await getStore();
    const pj = store.listProjects().find((p) => p.project === project);
    if (!pj || !pj.nodes) {
      return subsystem('code-graph', 'error', `no index for project '${project}' — run index-repository`, { projects: store.listProjects() }, new Date().toISOString());
    }
    const indexedAt = store.getMeta(`${project}:indexedAt`) || null;
    const cov = await coverageHandler({ project }).catch((e) => ({ error: String(e?.message || e) }));
    let headTs = null;
    try { headTs = Number(execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: ROOT, encoding: 'utf8' }).trim()) * 1000; } catch { /* not a repo? */ }
    const idxTs = indexedAt ? Date.parse(indexedAt) : null;
    const stale = Boolean(headTs && idxTs && headTs > idxTs);
    const ageMinutes = idxTs ? Math.round((Date.now() - idxTs) / 60000) : null;
    await closeStore();
    return subsystem(
      'code-graph',
      stale ? 'warn' : 'ok',
      `${pj.nodes} nodes / ${pj.edges} edges — coverage ${cov.coveragePct != null ? `${cov.coveragePct}%` : 'n/a'} — last index ${indexedAt ?? '?'} (${ageMinutes}m ago)${stale ? ' — STALE: HEAD commit is newer than the index' : ''}`,
      { project, nodes: pj.nodes, edges: pj.edges, backend: pj.backend || store.backend, indexedAt, ageMinutes, coverage: cov, headCommitTime: headTs ? new Date(headTs).toISOString() : null, stale },
      indexedAt || new Date().toISOString(),
    );
  } catch (e) {
    return subsystem('code-graph', 'error', `graph probe failed: ${String(e?.message || e).slice(0, 160)}`, undefined, new Date().toISOString());
  }
}

/* ── Scope E — reach channels ── */
async function checkReach() {
  try {
    const { checkAll } = await import(path.join(ROOT, 'capability/internet/reach/doctor.js').replace(/^file:\/\//, ''));
    const { ALL_CHANNELS } = await import(path.join(ROOT, 'capability/internet/reach/channels/index.js'));
    const { ReachConfig } = await import(path.join(ROOT, 'capability/internet/reach/config.js'));
    const rowsMap = await checkAll(new ReachConfig());
    const rows = Object.values(rowsMap);
    const byName = new Map(ALL_CHANNELS.map((c) => [c.name, c]));
    const channels = rows.map((r) => ({
      ...r,
      backends: byName.get(r.name)?.backends ?? null,
      active_backend: byName.get(r.name)?.active_backend ?? null,
    }));
    // Per-channel isolation is the Scope D contract: ONE channel's failed probe
    // is not a capability-layer outage. Subsystem is 'error' only when EVERY
    // channel fails; any warn/off/error channel is surfaced in warnings[]/
    // errors[] and in the per-channel detail.
    const errorCount = rows.filter((r) => r.status === 'error').length;
    const status = errorCount === rows.length && rows.length > 0 ? 'error' : rows.some((r) => r.status !== 'ok') ? 'warn' : 'ok';
    return subsystem(
      'reach',
      status,
      `${rows.length} channels — ${rows.filter((r) => r.status === 'ok').length} ok, ${rows.filter((r) => r.status === 'warn').length} warn, ${rows.filter((r) => r.status === 'off').length} off, ${rows.filter((r) => r.status === 'error').length} error`,
      { channels },
      new Date().toISOString(),
    );
  } catch (e) {
    return subsystem('reach', 'error', `reach probe failed: ${String(e?.message || e).slice(0, 160)}`, undefined, new Date().toISOString());
  }
}

/* ── Scope G — MCP servers ── */
function probeStdioServer(serverRelFile, expectTools, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn('node', [serverRelFile], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    const pending = new Map();
    let nextId = 0;
    const finish = (r) => { try { child.stdin.end(); child.kill('SIGTERM'); } catch { /* gone */ } resolve({ latencyMs: Date.now() - t0, ...r }); };
    const timer = setTimeout(() => finish({ ok: false, error: `timeout after ${timeoutMs}ms` }), timeoutMs);
    child.stdout.on('data', (d) => {
      buf += String(d);
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const p = pending.get(msg.id);
          if (p) { pending.delete(msg.id); p(msg); }
        } catch { /* ignore */ }
      }
    });
    child.stderr.on('data', () => { /* server logs — not protocol */ });
    child.on('error', (e) => { clearTimeout(timer); finish({ ok: false, error: `spawn failed: ${e.message}` }); });
    const call = (method, params) => new Promise((res, rej) => {
      const id = nextId += 1;
      pending.set(id, (msg) => (msg.error ? rej(new Error(msg.error.message)) : res(msg.result)));
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    (async () => {
      const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'phase11-doctor', version: '1.0.0' } });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      const list = await call('tools/list', {});
      clearTimeout(timer);
      finish({
        ok: true,
        server: init?.serverInfo?.name || serverRelFile,
        version: init?.serverInfo?.version || null,
        tools: (list?.tools || []).length,
        toolNames: (list?.tools || []).map((t) => t.name),
        expectTools,
        toolsMatch: (list?.tools || []).length === expectTools,
      });
    })().catch((e) => { clearTimeout(timer); finish({ ok: false, error: String(e?.message || e).slice(0, 160) }); });
  });
}

async function checkMcpServers() {
  try {
    const probes = [];
    for (const [file, expect] of [
      ['capability/code/mcp-server.js', 15],
      ['capability/internet/reach/mcp-server.js', 8],
    ]) {
      const r = await probeStdioServer(file, expect);
      probes.push({ file, ...r });
    }
    const bad = probes.filter((p) => !p.ok || !p.toolsMatch);
    const status = probes.every((p) => p.ok && p.toolsMatch) ? 'ok' : 'error';
    const message = probes
      .map((p) => (p.ok ? `${path.basename(p.file)}: ${p.tools}/${p.expectTools} tools (${p.latencyMs}ms)` : `${path.basename(p.file)}: FAILED — ${p.error}`))
      .join(' · ');
    return subsystem('mcp-servers', status, message, { servers: probes }, new Date().toISOString());
  } catch (e) {
    return subsystem('mcp-servers', 'error', `mcp probe failed: ${String(e?.message || e).slice(0, 160)}`, undefined, new Date().toISOString());
  }
}

/** Run every Phase 11 subsystem check. */
export async function runDoctor({ project = 'jexi-os' } = {}) {
  const timestamp = new Date().toISOString();
  const subsystems = [];
  for (const check of [checkDaemon, checkCodeGraph, checkReach, checkMcpServers]) {
    subsystems.push(await check(project));
  }
  const warnings = [];
  const errors = [];
  for (const s of subsystems) {
    for (const [lvl, bucket] of [['warn', warnings], ['off', errors], ['error', errors]]) {
      if (s.status === lvl) bucket.push(`${s.name}: ${s.message}`);
    }
    if (s.name === 'reach' && Array.isArray(s.detail?.channels)) {
      for (const r of s.detail.channels) {
        if (r.status === 'warn' || r.status === 'off') warnings.push(`reach/${r.name} [${r.status}]: ${r.message}`);
        if (r.status === 'error') errors.push(`reach/${r.name} [error]: ${r.message}`);
      }
    }
  }
  const healthy = subsystems.every((s) => s.status === 'ok' || s.status === 'warn');
  return {
    overall: healthy ? 'healthy' : 'unhealthy',
    healthy,
    timestamp,
    subsystems,
    warnings,
    errors,
  };
}

/** Human-readable report. */
export function formatDoctor(report) {
  const icon = { ok: '✅', warn: '⚠️ ', off: '⛔', error: '❌' };
  const lines = [];
  lines.push('════ JEXI OS — Phase 11 Unified Doctor ════');
  lines.push(`timestamp: ${report.timestamp}`);
  for (const s of report.subsystems) {
    lines.push(`${icon[s.status] ?? '·'} ${s.name.padEnd(16)} [${s.status}] ${s.message}`);
    if (s.name === 'reach' && Array.isArray(s.detail?.channels)) {
      for (const r of s.detail.channels) {
        lines.push(`      · ${r.name.padEnd(12)} [${r.status}] ${r.message}${r.backends ? ` — backends: ${JSON.stringify(r.backends)}` : ''}`);
      }
    }
  }
  lines.push(`overall: ${report.healthy ? 'HEALTHY' : 'UNHEALTHY'} — ${report.warnings.length} warning(s), ${report.errors.length} error(s)`);
  for (const w of report.warnings) lines.push(`  ⚠ ${w}`);
  for (const e of report.errors) lines.push(`  ✖ ${e}`);
  return lines.join('\n');
}
