#!/usr/bin/env node
/**
 * FINAL GAP 3 — FORGEJO BRIDGE TEST (2/2).
 *
 * T1  NO env: connect through the REAL gateway path (spawn the bridge with
 *     the official SDK transport) → tools/list returns EXACTLY the 6
 *     forgejo.* tools, and tools/call returns the honest
 *     "forgejo not configured" error naming FORGEJO_URL + FORGEJO_TOKEN.
 * T2  Mock FORGEJO_URL + FORGEJO_TOKEN: a REAL HTTP call is attempted —
 *     intercepted by a local mock forgejo (asserts the exact path, the
 *     Authorization: token <…> header scheme, and a real body for
 *     create_issue) — plus one unreachable-host call proving the honest
 *     network-error envelope.
 *
 * Exit 0 only on 2/2 PASS. Raw output printed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), `gap3-forgejo-${Date.now()}-`));

// the SDK lives in server/node_modules (the gateway resolves it from there too)
const sdkUrl = (rel) => pathToFileURL(path.join(ROOT, 'server', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', rel)).href;
const { Client } = await import(sdkUrl('client/index.js'));
const { StdioClientTransport } = await import(sdkUrl('client/stdio.js'));

const BRIDGE = path.join(ROOT, 'server', 'mcp', 'servers', 'forgejo-bridge.js');
const results = [];
const check = (id, ok, detail) => { results.push(ok); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id}${detail ? ` — ${detail}` : ''}`); };

async function spawnBridge(envOverrides) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BRIDGE],
    env: { ...process.env, ...envOverrides }, // FORGEJO_* deliberately absent in T1
    stderr: 'pipe',
  });
  const client = new Client({ name: 'forgejo-bridge-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport, { timeout: 30_000 });
  return { client, transport };
}

/* ── T1 — no env: 6 tools + honest not-configured ─────────────────────── */
async function t1() {
  const { client, transport } = await spawnBridge({ FORGEJO_URL: '', FORGEJO_TOKEN: '' });
  try {
    const listed = await client.listTools();
    const names = (listed.tools || []).map((t) => t.name).sort();
    const expected = ['forgejo.create_issue', 'forgejo.get_pr', 'forgejo.get_repo', 'forgejo.list_issues', 'forgejo.list_prs', 'forgejo.list_repos'];
    const listOk = names.length === 6 && JSON.stringify(names) === JSON.stringify(expected) && (listed.tools || []).every((t) => t.inputSchema && t.inputSchema.type === 'object');
    console.log(`  tools/list: ${JSON.stringify(names)}`);
    check('T1a tools/list returns the 6 forgejo.* tools with schemas', listOk, `${names.length}/6 · schemas=${(listed.tools || []).every((t) => !!t.inputSchema)}`);

    const inv = await client.callTool({ name: 'forgejo.list_repos', arguments: {} });
    const text = String(inv?.content?.[0]?.text || '');
    const parsed = JSON.parse(text);
    const honest = inv.isError === true && parsed.error === 'forgejo not configured' && parsed.missingEnv.includes('FORGEJO_URL') && parsed.missingEnv.includes('FORGEJO_TOKEN') && /FORGEJO_URL.*FORGEJO_TOKEN|set FORGEJO/.test(parsed.need);
    console.log(`  tools/call → isError=${inv.isError} error=${JSON.stringify(parsed.error)} missingEnv=${JSON.stringify(parsed.missingEnv)}`);
    check('T1b tools/call returns honest "forgejo not configured" with the exact env vars', honest, text.slice(0, 160));

    const inv2 = await client.callTool({ name: 'forgejo.create_issue', arguments: { owner: 'o', repo: 'r', title: 'x' } });
    check('T1c every tool honors the not-configured contract', inv2.isError === true && JSON.parse(String(inv2?.content?.[0]?.text || '{}')).error === 'forgejo not configured');
  } finally {
    try { await client.close(); } catch { /* gone */ }
    try { await transport.close(); } catch { /* gone */ }
  }
}

/* ── T2 — mock env: REAL HTTP attempted + intercepted ─────────────────── */
async function t2() {
  const hits = [];
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url.startsWith('/api/v1/repos/search')) res.end(JSON.stringify({ ok: true, data: [{ id: 1, full_name: 'demo/repo-one' }] }));
      else if (req.url === '/api/v1/repos/demo/repo-one/issues' && req.method === 'POST') res.end(JSON.stringify({ ok: true, number: 7, title: JSON.parse(body || '{}').title }));
      else if (req.url === '/api/v1/repos/demo/repo-one') res.end(JSON.stringify({ ok: true, full_name: 'demo/repo-one', stars: 3 }));
      else res.end(JSON.stringify({ ok: true, echoed: req.url }));
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const port = mock.address().port;
  const { client, transport } = await spawnBridge({ FORGEJO_URL: `http://127.0.0.1:${port}`, FORGEJO_TOKEN: 'test-token-1234' });
  try {
    // list_repos — real GET hits the mock
    const lr = await client.callTool({ name: 'forgejo.list_repos', arguments: {} });
    const lrJ = JSON.parse(String(lr?.content?.[0]?.text || '{}'));
    const hit1 = hits.find((h) => h.url.startsWith('/api/v1/repos/search'));
    console.log(`  list_repos → HTTP ${lrJ.httpStatus} ${lrJ.url} auth=${JSON.stringify(lrJ && hit1 && hit1.auth)} body=${String(lrJ.body).slice(0, 80)}`);
    const listOk = lrJ.ok === true && lr.isError !== true && hit1 && hit1.method === 'GET' && hit1.auth === 'token test-token-1234' && /demo\/repo-one/.test(lrJ.body);
    check('T2a real HTTP attempted + intercepted (path + token-scheme header + response body)', listOk);

    // create_issue — real POST with a JSON body
    const ci = await client.callTool({ name: 'forgejo.create_issue', arguments: { owner: 'demo', repo: 'repo-one', title: 'bridge smoke', body: 'from forgejo-bridge-test' } });
    const ciJ = JSON.parse(String(ci?.content?.[0]?.text || '{}'));
    const hit2 = hits.find((h) => h.url === '/api/v1/repos/demo/repo-one/issues');
    const postOk = ciJ.ok === true && ci.isError !== true && hit2 && hit2.method === 'POST' && JSON.parse(hit2.body).title === 'bridge smoke' && /"number":7/.test(ciJ.body);
    console.log(`  create_issue → HTTP ${ciJ.httpStatus} POST body echoed: ${JSON.stringify(hit2 && hit2.body).slice(0, 90)}`);
    check('T2b real POST body reaches the mock (create_issue end-to-end)', postOk);

    // unreachable host — honest network error envelope
    const { client: c3, transport: t3 } = await spawnBridge({ FORGEJO_URL: 'http://127.0.0.1:1', FORGEJO_TOKEN: 'x' });
    try {
      const nf = await c3.callTool({ name: 'forgejo.get_repo', arguments: { owner: 'demo', repo: 'repo-one' } });
      const nfJ = JSON.parse(String(nf?.content?.[0]?.text || '{}'));
      const honestNet = nf.isError === true && /forgejo unreachable/.test(nfJ.error);
      console.log(`  get_repo(unreachable) → isError=${nf.isError} error=${JSON.stringify(nfJ.error).slice(0, 90)}`);
      check('T2c unreachable instance → honest network-error envelope', honestNet);
    } finally {
      try { await c3.close(); } catch { /* gone */ }
      try { await t3.close(); } catch { /* gone */ }
    }
  } finally {
    try { await client.close(); } catch { /* gone */ }
    try { await transport.close(); } catch { /* gone */ }
    mock.close();
  }
}

console.log('FINAL GAP 3 — FORGEJO BRIDGE TEST');
console.log('═════════════════════════════════');
await t1();
await t2();
const pass = results.filter(Boolean).length;
console.log('─────────────────────────────────');
console.log(` GAP 3 RESULT: ${pass}/${results.length} checks PASS (2/2 test groups)`);
process.exit(pass === results.length ? 0 : 1);
