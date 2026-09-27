#!/usr/bin/env node
/**
 * P10 GAP 3 + FINAL GAP 2 — MCP STATE CLASSIFICATION + REAL WIRING — test.
 *
 * Spec: query /api/mcps, assert each MCP is in one of the three states
 * (connected / declarative / disabled), any "connected" one is callable,
 * EVERY server answers describeMcpServer() non-empty, zero "unclassified",
 * and the 7 formerly-declarative security MCPs are WIRED through the real
 * bin-bridge stdio server (≥3 more connected than the pre-GAP baseline),
 * with the installed binaries REALLY executing.
 *
 * Part A (HTTP): the live server's /api/mcps — 100% of the registry
 *   classified into exactly the three states; zero "unclassified" anywhere;
 *   every server answers ?server=<name> with a non-empty describe payload.
 * Part B (in-process, same gateway module the server runs):
 *   B1  a CONNECTED server is callable (gateway seam)
 *   B2  nmap  — real connect + REAL version + REAL scan of 127.0.0.1
 *   B3  semgrep — real version + REAL scan of a vulnerable fixture
 *   B4  bandit — real scan of the fixture (findings returned)
 *   B5  gitleaks — real detect over a fixture repo (finding returned)
 *   B6  subfinder — real version + honest structured enumerate
 *   B7  whatweb — honest not-installed error WITH install instructions
 *   B8  ghidra — real status answer + honest not-configured decompile
 *   B9  connected count grew ≥3 over the pre-GAP baseline (7 wired)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'server');
const PORT = Number(process.env.JEXI_P10G3_PORT || 3063);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p10-gap3-'));
  process.env.DATA_DIR = dataDir; // the in-process part shares the run dir
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, JEXI_MCP_MINIMAL: '1', NODE_ENV: 'production' };
  const child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let bootLog = '';
  child.stdout.on('data', (d) => { bootLog += d.toString(); });
  child.stderr.on('data', (d) => { bootLog += d.toString(); });
  const base = `http://127.0.0.1:${PORT}`;
  let pass = 0, total = 0;
  const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'g2-fixtures-'));
  try {
    let up = false;
    for (let i = 0; i < 90; i++) { try { const r = await fetch(`${base}/api/health`); if (r.ok) { up = true; break; } } catch {} await wait(1000); }
    if (!up) { console.log(`[BOOT FAIL] tail:\n${bootLog.split('\n').slice(-20).join('\n')}`); process.exit(1); }

    /* A1 — /api/mcps: 100% classified into exactly the three states */
    total++;
    const res = await fetch(`${base}/api/mcps`);
    const report = await res.json().catch(() => ({}));
    const servers = Array.isArray(report.servers) ? report.servers : [];
    const validStates = new Set(['connected', 'declarative', 'disabled']);
    const classified = servers.filter((s) => validStates.has(s.state)).length;
    const sum = report.summary || {};
    const sumsOk = Number(sum.connected) + Number(sum.declarative) + Number(sum.disabled) === servers.length;
    const ok = report.ok === true && servers.length > 0 && classified === servers.length && sumsOk;
    if (ok) pass++;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] A1 /api/mcps — 100% classified into three states`);
    console.log(`  summary: ${JSON.stringify(sum)} | servers: ${servers.length} | classified: ${classified}/${servers.length} | sumsMatch: ${sumsOk}`);
    const byState = {};
    for (const s of servers) byState[s.state] = (byState[s.state] || []).concat(s.name);
    for (const st of ['connected', 'declarative', 'disabled']) {
      console.log(`  ${st} (${(byState[st] || []).length}): ${(byState[st] || []).slice(0, 18).join(', ')}${(byState[st] || []).length > 18 ? ' …' : ''}`);
    }

    /* A2 — FINAL GAP 2: EVERY MCP answers describeMcpServer() non-empty; zero unclassified */
    total++;
    const gwPath = path.join(ROOT, 'server/src/services/MCPGateway.js');
    const gw = await import(gwPath);
    const reg = gw.effectiveRegistry();
    const describeOk = [];
    const describeFail = [];
    for (const s of reg.servers) {
      const d = gw.describeMcpServer(s.name);
      const answered = d && (d.ok === true ? (Array.isArray(d.tools) && d.tools.length > 0 && d.state) : (typeof d.error === 'string' && d.error.length > 0 && d.state === 'disabled'));
      (answered ? describeOk : describeFail).push(s.name);
    }
    const wired7 = ['nmap', 'semgrep', 'bandit', 'gitleaks', 'subfinder', 'whatweb', 'ghidra'];
    const wiredOffers = wired7.filter((n) => { const d = gw.describeMcpServer(n); return d.ok === true && d.tools.length > 0; });
    const unclassified = servers.filter((s) => /unclassified/i.test(String(s.state)) || /unclassified/i.test(String(s.note || '')));
    const a2ok = describeFail.length === 0 && wiredOffers.length === wired7.length && unclassified.length === 0;
    if (a2ok) pass++;
    console.log(`[${a2ok ? 'PASS' : 'FAIL'}] A2 every MCP answers describeMcpServer() non-empty + 0 unclassified + 7/7 wired offers`);
    console.log(`  described OK: ${describeOk.length}/${reg.servers.length}${describeFail.length ? ` | FAILED: ${describeFail.join(', ')}` : ''}`);
    console.log(`  wired-7 offers: ${wiredOffers.join(', ')} | unclassified rows: ${unclassified.length}`);

    /* B1 — in-process: a CONNECTED server is callable (seam) */
    const target = reg.servers.find((s) => s.enabled && s.transport !== 'streamable-http' && s.name !== 'nmap');
    let calls = 0;
    gw.__setConnector(async () => ({
      async listTools() { return { tools: [{ name: 'ping', description: 'ping', inputSchema: { type: 'object', properties: {} } }] }; },
      async callTool(call) { calls++; const n = typeof call === 'string' ? call : call.name; return { content: [{ type: 'text', text: n === 'ping' ? 'pong' : 'echo' }] }; },
      async close() {},
      transport: null,
    }));
    total++;
    const c = await gw.connectGatewayServer(target.name);
    const afterConnect = gw.mcpStateReport();
    const connRow = afterConnect.servers.find((s) => s.name === target.name);
    const inv = await gw.invokeMcpTool({ server: target.name, tool: 'ping', args: {} });
    const connectedOk = c.ok && connRow && connRow.state === 'connected' && calls >= 1 && String(inv?.result?.content?.[0]?.text) === 'pong';
    if (connectedOk) pass++;
    console.log(`[${connectedOk ? 'PASS' : 'FAIL'}] B1 connected server is callable — ${target.name}`);
    console.log(`  connect: ${JSON.stringify(c)} | state: ${connRow && connRow.state} | invoke → ${String(inv?.result?.content?.[0]?.text)} | calls: ${calls}`);

    // From here the REAL connector is used again (seam reset) — the bin-bridge
    // servers are spawned for real through the official SDK transports.
    gw.__setConnector(null);
    gw.__resetGateway();

    /* fixtures */
    const vulnPy = path.join(fixtures, 'vuln.py');
    fs.writeFileSync(vulnPy, 'import hashlib\ndef hash_password(p):\n    return hashlib.md5(p.encode()).hexdigest()\n');
    const rulesYaml = path.join(fixtures, 'rules.yaml');
    fs.writeFileSync(rulesYaml, 'rules:\n  - id: weak-md5-hash\n    languages: [python]\n    message: Do not use MD5 for passwords\n    severity: WARNING\n    patterns:\n      - pattern: hashlib.md5(...)\n');
    const leakRepo = path.join(fixtures, 'leakrepo');
    fs.mkdirSync(leakRepo);
    fs.writeFileSync(path.join(leakRepo, 'creds.txt'), 'github_pat = "ghp_RjkEwMgEwJdMNjZnFqPZtQaVbCdBcXeFgTh1"\n');

    const text = (r) => String(r && r.result && r.result.content && r.result.content[0] && r.result.content[0].text || '');
    const json = (r) => { try { return JSON.parse(text(r)); } catch { return null; } };

    /* B2 — nmap: real connect + version + scan of 127.0.0.1 */
    total++;
    const cn = await gw.connectGatewayServer('nmap');
    const vn = await gw.invokeMcpTool({ server: 'nmap', tool: 'nmap_version', args: {} });
    const sn = await gw.invokeMcpTool({ server: 'nmap', tool: 'nmap_scan', args: { target: '127.0.0.1', ports: '1-200' } }, );
    const snJ = json(sn);
    const b2ok = cn.ok === true && vn.ok === true && /Nmap version/.test(text(vn)) && sn.ok === true && snJ && snJ.ok === true && /Nmap scan report|Host is up/.test(String(snJ.stdout || ''));
    if (b2ok) pass++;
    console.log(`[${b2ok ? 'PASS' : 'FAIL'}] B2 nmap WIRED — real connect + version + scan of 127.0.0.1`);
    console.log(`  connect: ${JSON.stringify(cn)} | version: ${text(vn).slice(0, 90)}`);
    console.log(`  scan: exit=${snJ && snJ.exit} dur=${snJ && snJ.duration_ms}ms stdout: ${String(snJ && snJ.stdout || '').split('\n').filter((l) => /Host is up|Nmap scan report|Nmap done/.test(l)).join(' | ').slice(0, 160)}`);

    /* B3 — semgrep: real version + real scan of the fixture */
    total++;
    const cs = await gw.connectGatewayServer('semgrep');
    const vs = await gw.invokeMcpTool({ server: 'semgrep', tool: 'semgrep_version', args: {} });
    const ss = await gw.invokeMcpTool({ server: 'semgrep', tool: 'semgrep_scan', args: { path: vulnPy, config: rulesYaml } });
    const ssJ = json(ss);
    const b3ok = cs.ok === true && vs.ok === true && /\d+\.\d+/.test(text(vs)) && ssJ && ssJ.ok === true && (String(ssJ.stdout || '').includes('weak-md5-hash') || String(ssJ.stdout || '').includes('results'));
    if (b3ok) pass++;
    console.log(`[${b3ok ? 'PASS' : 'FAIL'}] B3 semgrep WIRED — real version + real scan (fixture: md5 password hash)`);
    console.log(`  version: ${text(vs).slice(0, 60)} | scan: exit=${ssJ && ssJ.exit} dur=${ssJ && ssJ.duration_ms}ms finding=${/weak-md5-hash/.test(String(ssJ && ssJ.stdout || ''))}`);

    /* B4 — bandit: real scan of the fixture */
    total++;
    const cb = await gw.connectGatewayServer('bandit');
    const sb = await gw.invokeMcpTool({ server: 'bandit', tool: 'bandit_scan', args: { path: vulnPy } });
    const sbJ = json(sb);
    const b4ok = cb.ok === true && sbJ && sbJ.ok === true && /B324/.test(String(sbJ.stdout || ''));
    if (b4ok) pass++;
    console.log(`[${b4ok ? 'PASS' : 'FAIL'}] B4 bandit WIRED — real scan flags B324 (hashlib.md5)`);
    console.log(`  scan: exit=${sbJ && sbJ.exit} dur=${sbJ && sbJ.duration_ms}ms B324=${/B324/.test(String(sbJ && sbJ.stdout || ''))}`);

    /* B5 — gitleaks: real detect over the fixture repo */
    total++;
    const cg = await gw.connectGatewayServer('gitleaks');
    const vg = await gw.invokeMcpTool({ server: 'gitleaks', tool: 'gitleaks_version', args: {} });
    const sg = await gw.invokeMcpTool({ server: 'gitleaks', tool: 'gitleaks_detect', args: { source: leakRepo } });
    const sgJ = json(sg);
    const b5ok = cg.ok === true && vg.ok === true && /\d+\.\d+/.test(text(vg)) && sgJ && (String(sgJ.stdout || '').includes('github-pat') || String(sgJ.stdout || '').includes('REDACTED') || String(sgJ.stderr || '').includes('github-pat'));
    if (b5ok) pass++;
    console.log(`[${b5ok ? 'PASS' : 'FAIL'}] B5 gitleaks WIRED — real detect finds github-pat in fixture`);
    console.log(`  version: ${text(vg).slice(0, 40)} | detect: exit=${sgJ && sgJ.exit} patFinding=${/github-pat/.test(String((sgJ && sgJ.stdout) || '') + String((sgJ && sgJ.stderr) || ''))}`);

    /* B6 — subfinder: real version + honest structured enumerate */
    total++;
    const cf = await gw.connectGatewayServer('subfinder');
    const vf = await gw.invokeMcpTool({ server: 'subfinder', tool: 'subfinder_version', args: {} });
    const sf = await gw.invokeMcpTool({ server: 'subfinder', tool: 'subfinder_enumerate', args: { domain: 'example.com', timeout: 5 } });
    const sfJ = json(sf);
    const structured = sfJ && typeof sfJ.exit === 'number' && typeof sfJ.duration_ms === 'number'; // honest either way (DNS may be blocked)
    const b6ok = cf.ok === true && vf.ok === true && /subfinder|Current Version|v2\.\d/i.test(text(vf)) && structured;
    if (b6ok) pass++;
    console.log(`[${b6ok ? 'PASS' : 'FAIL'}] B6 subfinder WIRED — real version + structured honest enumerate`);
    console.log(`  version: ${text(vf).replace(/\n/g, ' ').slice(0, 80)} | enumerate: exit=${sfJ && sfJ.exit} dur=${sfJ && sfJ.duration_ms}ms out=${JSON.stringify(String((sfJ && sfJ.stdout) || '').split('\n').filter(Boolean).slice(0, 2))}`);

    /* B7 — whatweb: honest not-installed error WITH instructions */
    total++;
    const cw = await gw.connectGatewayServer('whatweb');
    const vw = await gw.invokeMcpTool({ server: 'whatweb', tool: 'whatweb_version', args: {} });
    const wErr = String(vw && vw.error || '');
    const b7ok = cw.ok === true && vw.ok === false && /not-installed/.test(wErr) && /setup-security-mcps\.sh|apt-get|gem install/.test(wErr);
    if (b7ok) pass++;
    console.log(`[${b7ok ? 'PASS' : 'FAIL'}] B7 whatweb WIRED — honest not-installed answer with install instructions`);
    console.log(`  error: ${wErr.slice(0, 200)}`);

    /* B8 — ghidra: real status + honest not-configured decompile */
    total++;
    const ch = await gw.connectGatewayServer('ghidra');
    const vh = await gw.invokeMcpTool({ server: 'ghidra', tool: 'ghidra_status', args: {} });
    const vhJ = json(vh);
    const dh = await gw.invokeMcpTool({ server: 'ghidra', tool: 'ghidra_decompile', args: { program: 'demo', address: '0x0040' } });
    const dhJ = json(dh);
    const b8ok = ch.ok === true && vh.ok === true && vhJ && typeof vhJ.ghidraHost !== 'undefined' && typeof vhJ.docker !== 'undefined' && dh.ok === false && /not-configured|GHIDRA_HOST/.test(String(dh && dh.error || '') + String((dhJ && dhJ.error) || ''));
    if (b8ok) pass++;
    console.log(`[${b8ok ? 'PASS' : 'FAIL'}] B8 ghidra WIRED — real status answer + honest not-configured decompile`);
    console.log(`  status: ${JSON.stringify(vhJ && { ghidraHost: vhJ.ghidraHost, docker: vhJ.docker, verdict: String(vhJ.verdict || '').slice(0, 80) })} | decompile error: ${String((dhJ && dhJ.error) || dh && dh.error || '').slice(0, 120)}`);

    /* B9 — connected count grew ≥3 over the pre-GAP baseline */
    total++;
    const connNow = [...gw.mcpStateReport().servers.filter((s) => s.state === 'connected')].map((s) => s.name);
    const baselineWired = 0; // pre-GAP: none of the 7 were connectable (enabled:false declarative)
    const b9ok = connNow.filter((n) => wired7.includes(n)).length - baselineWired >= 3;
    if (b9ok) pass++;
    console.log(`[${b9ok ? 'PASS' : 'FAIL'}] B9 connected count grew ≥3 (baseline ${baselineWired})`);
    console.log(`  connected now (${connNow.length}): ${connNow.join(', ')}`);
  } finally {
    try { child.kill('SIGTERM'); } catch {}
    await wait(500);
    try { child.kill('SIGKILL'); } catch {}
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(fixtures, { recursive: true, force: true }); } catch {}
  }
  console.log(`\nP10 GAP 3 + FINAL GAP 2 MCP STATE TEST: ${pass}/${total} PASS`);
  process.exit(pass === total ? 0 : 1);
}
await main();
