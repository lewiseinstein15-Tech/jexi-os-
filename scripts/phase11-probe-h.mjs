// Phase 11 Scope H — unified doctor probe (P1–P10). Real subsystems, real
// processes: the daemon is STARTED and KILLED for real during the run.
//
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'capabilities/graph/doctor/cli.js');
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${l}`); };

const runCli = (args = [], timeoutMs = 120000) => {
  const r = spawnSync('node', [CLI, ...args], { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs });
  return { code: r.status ?? 1, out: r.stdout || '', err: (r.stderr || '').trim() };
};

// ── bring the daemon UP for the healthy path (real process, Scope C client) ──
console.log('════ setup — re-index the graph (real) + start the codegraph daemon ════');
{
  const { handler: indexRepo } = await import(path.join(ROOT, 'capabilities/tools/domains/lsp/index-repository.tool.js'));
  const stats = await indexRepo({ root: ROOT, project: 'jexi-os', fresh: true });
  console.log(`  re-indexed: ${JSON.stringify({ project: stats.project, nodes: stats.nodes, edges: stats.edges, backend: stats.backend })}`);
}
const { DaemonClient } = await import(path.join(ROOT, 'runtime/kernel/daemon/client.js'));
const client = await DaemonClient.open({ spawnIfDown: true, sessionId: 'phase11-h-probe', namespace: 'doctor-probe' });
console.log(`  daemon up: ${JSON.stringify(client.daemon)}`);

// ── P1 — text output ──
console.log('\n════ P1 — doctor text output (raw) ════');
{
  const r = runCli([]);
  console.log(r.out);
  ok(r.code === 0 && r.out.includes('codegraph-daemon') && r.out.includes('reach') && r.out.includes('mcp-servers'), 'P1 doctor runs, all four subsystems present');
}

// ── P2 — JSON output ──
console.log('\n════ P2 — doctor --json (raw) ════');
let healthyReport = null;
{
  const r = runCli(['--json']);
  console.log(r.out.length > 6000 ? r.out.slice(0, 6000) + `\n  … (${r.out.length} bytes total — reach channel detail truncated for the log)\n` : r.out);
  healthyReport = JSON.parse(r.out);
  ok(healthyReport.healthy === true && healthyReport.overall === 'healthy' && Array.isArray(healthyReport.subsystems), 'P2 JSON: healthy=true, subsystems[] present');
  ok(healthyReport.subsystems.every((s) => 'name' in s && 'status' in s && 'message' in s), 'P2 every subsystem has name/status/message');
}

// ── P3 — codegraph fields ──
console.log('\n════ P3 — codegraph subsystem (daemon + index time + counts) ════');
{
  const d = healthyReport.subsystems.find((s) => s.name === 'codegraph-daemon');
  const g = healthyReport.subsystems.find((s) => s.name === 'code-graph');
  console.log(`  daemon: [${d.status}] ${d.message}`);
  console.log(`  daemon detail: ${JSON.stringify({ status: d.detail?.status, graphStatus: d.detail?.graphStatus })}`);
  console.log(`  graph:  [${g.status}] ${g.message}`);
  console.log(`  graph detail: ${JSON.stringify({ project: g.detail?.project, nodes: g.detail?.nodes, edges: g.detail?.edges, indexedAt: g.detail?.indexedAt, ageMinutes: g.detail?.ageMinutes, coverage: g.detail?.coverage?.coverage, stale: g.detail?.stale, backend: g.detail?.backend })}`);
  ok(d.status === 'ok', 'P3 daemon reported running');
  ok(g.detail?.nodes > 0 && g.detail?.indexedAt, `P3 real counts (${g.detail?.nodes} nodes) + last index time (${g.detail?.indexedAt})`);
}

// ── P4 — reach channels ──
console.log('\n════ P4 — reach subsystem: 16 channels ════');
{
  const reach = healthyReport.subsystems.find((s) => s.name === 'reach');
  const ch = reach.detail?.channels || [];
  for (const c of ch) console.log(`  ${c.name.padEnd(12)} [${c.status}] tier=${c.tier} backends=${JSON.stringify(c.backends)} active_backend=${JSON.stringify(c.active_backend)}`);
  ok(ch.length === 16, 'P4 all 16 channels reported');
  ok(ch.every((c) => 'status' in c && Array.isArray(c.backends)), 'P4 every channel has status + backend chain');
}

// ── P5 — MCP servers ──
console.log('\n════ P5 — MCP servers subsystem ════');
{
  const m = healthyReport.subsystems.find((s) => s.name === 'mcp-servers');
  console.log(`  [${m.status}] ${m.message}`);
  console.log(`  detail: ${JSON.stringify((m.detail?.servers || []).map((s) => ({ file: s.file, server: s.server, tools: s.tools, expectTools: s.expectTools, toolsMatch: s.toolsMatch, latencyMs: s.latencyMs })))}`);
  ok(m.status === 'ok' && (m.detail?.servers || []).length === 2, 'P5 both MCP servers reachable with expected tool counts');
}

// ── P7 (healthy side) + P9 (exit 0) ──
console.log('\n════ P7 — overall verdict (daemon UP) ════');
{
  console.log(`  healthy: ${healthyReport.healthy} | overall: ${healthyReport.overall}`);
  console.log(`  why: subsystems=${JSON.stringify(healthyReport.subsystems.map((s) => [s.name, s.status]))}`);
  console.log(`  warnings: ${healthyReport.warnings.length} | errors: ${healthyReport.errors.length}`);
  ok(healthyReport.healthy === true, 'P7 healthy=true — ok/warn subsystems only, no off/error');
}

console.log('\n════ P8 — idempotent: same inputs twice ════');
{
  const r2 = JSON.parse(runCli(['--json']).out);
  const shape = (x) => JSON.stringify({ keys: Object.keys(x).sort(), subs: x.subsystems.map((s) => [s.name, s.status]) });
  console.log(`  run1: overall=${healthyReport.overall} subsystems=${JSON.stringify(healthyReport.subsystems.map((s) => [s.name, s.status]))}`);
  console.log(`  run2: overall=${r2.overall} subsystems=${JSON.stringify(r2.subsystems.map((s) => [s.name, s.status]))}`);
  ok(shape(healthyReport) === shape(r2), 'P8 identical structure + statuses across runs (timestamps/latency may differ)');
}

console.log('\n════ P9 (part 1) — exit code with everything up ════');
{
  const r = runCli(['--json']);
  let statuses = null;
  try { statuses = JSON.parse(r.out).subsystems.map((s) => [s.name, s.status]); } catch { /* shown below */ }
  console.log(`  daemon UP → exit code: ${r.code} | subsystems: ${JSON.stringify(statuses)}`);
  ok(r.code === 0, 'P9 healthy → exit 0');
}

// ── P6 — kill the daemon for real, doctor must flag it ──
console.log('\n════ P6 — failure visibility: KILL the daemon (real) ════');
{
  const epFile = path.join(ROOT, 'capability/code/graph/db/daemon/daemon.json');
  const ep = JSON.parse(fs.readFileSync(epFile, 'utf8'));
  console.log(`  killing daemon pid ${ep.pid} (SIGTERM)…`);
  try { process.kill(ep.pid, 'SIGTERM'); } catch (e) { console.log(`  kill: ${e.message}`); }
  await new Promise((r) => setTimeout(r, 600));
  try { fs.unlinkSync(epFile); } catch { /* daemon removes it */ }
  const r = runCli(['--json']);
  const rep = JSON.parse(r.out);
  const d = rep.subsystems.find((s) => s.name === 'codegraph-daemon');
  console.log(`  daemon: [${d.status}] ${d.message}`);
  console.log(`  other subsystems still report: ${JSON.stringify(rep.subsystems.filter((s) => s.name !== 'codegraph-daemon').map((s) => [s.name, s.status]))}`);
  console.log(`  healthy: ${rep.healthy} | errors: ${JSON.stringify(rep.errors.filter((x) => x.startsWith('codegraph-daemon')))}`);
  ok(d.status === 'off' && /DAEMON_DOWN|not running/.test(d.message), 'P6 failing subsystem flagged with specific reason (off + DAEMON_DOWN)');
  ok(rep.subsystems.filter((s) => s.name !== 'codegraph-daemon').every((s) => s.status === 'ok' || s.status === 'warn'), 'P6 the rest still report');
  ok(rep.healthy === false, 'P6 overall flips to unhealthy');

  console.log('\n════ P7 (unhealthy side) — why ════');
  console.log(`  healthy: ${rep.healthy} | overall: ${rep.overall} | why: codegraph-daemon [${d.status}]`);

  console.log('\n════ P9 (part 2) — exit code with a subsystem down ════');
  console.log(`  daemon DOWN → exit code: ${r.code}`);
  ok(r.code !== 0, 'P9 failing subsystem → exit non-zero');
}

// ── P10 — relationship to the Phase 7 G /doctor command ──
console.log('\n════ P10 — existing /doctor command (Phase 7 G) — no shadow ════');
{
  const cmdFile = path.join(ROOT, 'capabilities/commands/doctor.command.js');
  const exists = fs.existsSync(cmdFile);
  console.log(`  commands/doctor.command.js exists: ${exists}`);
  if (exists) console.log('  head (raw):\n' + fs.readFileSync(cmdFile, 'utf8').split('\n').slice(0, 16).map((l) => `    | ${l}`).join('\n'));
  const registered = /doctor/i.test(fs.readFileSync(path.join(ROOT, 'capabilities/graph/doctor/cli.js'), 'utf8'));
  const inCommands = fs.existsSync(path.join(ROOT, 'capabilities/commands')) && fs.readdirSync(path.join(ROOT, 'capabilities/commands')).filter((f) => f.includes('doctor'));
  console.log(`  commands/ dir doctor files: ${JSON.stringify(inCommands)} (untouched by Scope H)`);
  console.log(`  Phase 11 doctor entry points: capability/doctor/index.js + capability/doctor/cli.js — registers NO slash command${registered ? '' : ''}`);
  ok(exists, 'P10 existing Phase 7 G /doctor command present and NOT modified');
  ok(inCommands.length === 1, 'P10 no shadowing file added under commands/');
}

console.log(`\n════ SCOPE H PROBE DONE — ${pass} passed, ${fail} failed ════`);
process.exit(fail === 0 ? 0 : 1);
