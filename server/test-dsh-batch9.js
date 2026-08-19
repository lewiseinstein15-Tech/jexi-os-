/**
 * B140 — DSH BATCH 9 TEST ("Continue pulling all"):
 *
 *   schedule/schedule tools            → schedule_create/list/delete registry tools
 *   bundle/base                        → BundleBase.js + bundles/manifest.json + DSH-PARITY.md
 *   api/gateway client                 → src/utils/gatewayClient.js
 *   client/runtime                     → src/utils/jexiRuntime.js + hooks/useProjection.js
 *   sdk/client                         → server/sdk/client.js
 *   subprocess scrubbed-parent-env     → ShellEnv.scrubbedParentEnv
 */

import fs from 'fs';
import http from 'http';
import path from 'path';
import { pathToFileURL } from 'url';

let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures += 1;
};

const SERVER_DIR = process.cwd();

/* ══════════════ 1. SCHEDULE TOOLS ══════════════ */
console.log('\n== 1. Schedule tools (dsh schedule tools) ==');
{
  const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');
  ok('three schedule tools in registry', ['schedule_create', 'schedule_list', 'schedule_delete'].every((s) => TOOL_REGISTRY.some((t) => t.slug === s)));
  ok('registry count is 210', TOOL_COUNT === 210);
  const { executeTool, hasOutputContract, validateToolArgs } = await import('./src/services/ToolRuntime.js');
  ok('schedule tools have output contracts', hasOutputContract('schedule_create') && hasOutputContract('schedule_list') && hasOutputContract('schedule_delete'));
  ok('create validates query', validateToolArgs('schedule_create', { query: 'x', everySeconds: 60 }).ok === true);
  ok('create requires query', validateToolArgs('schedule_create', {}).ok === false);
  const parseRes = (r) => { try { return typeof r.result === 'string' ? JSON.parse(r.result) : (r.result || r); } catch { return r.result || r; } };
  const created = await executeTool({ slug: 'schedule_create', args: { query: 'B140 schedule test', everySeconds: 3600, label: 'B140 test' }, spillOwner: 't-sched' });
  const createdBody = parseRes(created);
  ok('schedule_create executes', created.ok === true && createdBody.schedule && createdBody.schedule.id);
  const schedId = createdBody.schedule.id;
  const listed = await executeTool({ slug: 'schedule_list', args: {}, spillOwner: 't-sched' });
  ok('schedule_list returns the schedule', listed.ok === true && String(JSON.stringify(parseRes(listed))).includes(schedId));
  const deleted = await executeTool({ slug: 'schedule_delete', args: { id: schedId }, spillOwner: 't-sched' });
  ok('schedule_delete removes it', deleted.ok === true);
  const bad = await executeTool({ slug: 'schedule_delete', args: { id: 'nope-123' }, spillOwner: 't-sched' });
  ok('schedule_delete unknown fails honestly', bad.ok === false && /no schedule/.test(String(bad.error)));
}

/* ══════════════ 2. BUNDLE BASE ══════════════ */
console.log('\n== 2. Bundle base (manifest + parity tracker) ==');
{
  const { bundleStatus, readBundleManifest, MANIFEST_FILE, PARITY_FILE } = await import('./src/services/BundleBase.js');
  ok('manifest exists', fs.existsSync(MANIFEST_FILE));
  ok('parity doc exists', fs.existsSync(PARITY_FILE));
  const manifest = readBundleManifest();
  ok('manifest lists packages', manifest.packages.length > 100);
  const st = bundleStatus();
  ok('status counts', st.ok && st.counts.total === manifest.packages.length && st.counts.ported > 100);
  ok('status includes registry facts', st.registryTools === 210);
  ok('parity doc has the tracker table', fs.readFileSync(PARITY_FILE, 'utf-8').includes('| ✅ core/session |'));
  const parity = fs.readFileSync(PARITY_FILE, 'utf-8');
  ok('parity doc has status legend', parity.includes('not-yet') && parity.includes('ported'));
}

/* ══════════════ 3. GATEWAY CLIENT (frontend) ══════════════ */
console.log('\n== 3. Gateway client (api/gateway client mirror) ==');
{
  const mod = await import(pathToFileURL(path.join(SERVER_DIR, '..', 'src', 'utils', 'gatewayClient.js')).href);
  const { gatewayFetch, GatewayError, getAccessKey } = mod;

  // A tiny local HTTP server to exercise retry + key header + errors.
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    const key = req.headers['x-jexi-key'] || '';
    if (req.url === '/flaky') {
      if (hits < 3) { res.writeHead(500); res.end('{}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, key }));
      return;
    }
    if (req.url === '/boom') { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'bad thing' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, key }));
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const normal = await gatewayFetch(`${base}/ok`, { key: 'sekret' });
  ok('sends x-jexi-key', normal.ok && normal.data.key === 'sekret');
  const flaky = await gatewayFetch(`${base}/flaky`, { key: 'k', retries: 3, timeoutMs: 5000 });
  ok('retries idempotent GETs with backoff', flaky.ok && hits >= 3);
  let boomErr = null;
  try { await gatewayFetch(`${base}/boom`, { retries: 0 }); } catch (e) { boomErr = e; }
  ok('4xx surfaces normalized GatewayError', boomErr instanceof GatewayError && boomErr.status === 400 && boomErr.data.error === 'bad thing');
  let timeoutErr = null;
  try { await gatewayFetch(`${base}/ok`, { timeoutMs: 1, retries: 0, signal: AbortSignal.timeout(5) }); } catch (e) { timeoutErr = e; }
  ok('timeout → GatewayError code TIMEOUT or NETWORK', timeoutErr instanceof GatewayError && (timeoutErr.code === 'TIMEOUT' || timeoutErr.code === 'NETWORK'));
  server.close();
  ok('getAccessKey defined', typeof getAccessKey === 'function');
}

/* ══════════════ 4. CLIENT RUNTIME (frontend) ══════════════ */
console.log('\n== 4. Client runtime + projection store ==');
{
  const mod = await import(pathToFileURL(path.join(SERVER_DIR, '..', 'src', 'utils', 'jexiRuntime.js')).href);
  const { ConnectionStatus, LocaleRuntime, ProjectionStore } = mod;

  const locale = new LocaleRuntime({ fetchStrings: false });
  locale.strings = { 'chat.send': 'Send', 'app.name': 'JEXI OS' };
  ok('locale t() resolves', locale.t('chat.send') === 'Send');
  ok('locale t() falls back to key', locale.t('nope') === 'nope');
  ok('locale t() substitutes vars', locale.t('hello {name}', { name: 'JEXI' }) === 'hello JEXI');

  const store = new ProjectionStore({ base: '/api/sessions' });
  ok('projection store constructed', store.cache instanceof Map);
  store.invalidate('conv-x');
  store.clear();
  ok('projection store invalidate/clear', store.cache.size === 0);

  const conn = new ConnectionStatus({ pollMs: 60000 });
  ok('connection status starts unknown', conn.state === 'unknown');
  conn.stop();
  ok('connection status stops cleanly', conn.timer === null);
}

/* ══════════════ 5. SDK CLIENT ══════════════ */
console.log('\n== 5. JEXI SDK (sdk/client) ==');
{
  const { JexiClient, sdkSelfCheck } = await import('./sdk/client.js');

  // Tiny server exercising health + chat NDJSON stream.
  const server = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, build: { commit: 'sdk-test' } }));
      return;
    }
    if (req.url === '/api/chat') {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write('{"type":"log","message":"thinking"}\n');
      res.end('{"type":"done","success":true,"summary":"SDK ANSWER"}\n');
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise((r) => server.listen(0, r));
  const client = new JexiClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, key: 'sdkkey' });
  const health = await client.health();
  ok('sdk health', health.ok === true && health.build.commit === 'sdk-test');
  const answer = await client.chat('hello');
  ok('sdk chat returns summary from NDJSON stream', answer === 'SDK ANSWER');
  ok('sdk sends key header', (() => { const h = client._headers(); return h['x-jexi-key'] === 'sdkkey'; })());
  server.close();
  const checks = sdkSelfCheck();
  ok('sdk self-check passes', checks.length === 2 && checks.every((c) => c.ok));
  ok('sdk README exists', fs.existsSync(path.join(SERVER_DIR, 'sdk', 'README.md')));
}

/* ══════════════ 6. SCRUBBED PARENT ENV + INTEGRATION ══════════════ */
console.log('\n== 6. Scrub parity + integration ==');
{
  const { scrubbedParentEnv } = await import('./src/services/ShellEnv.js');
  ok('scrubbedParentEnv parity name', typeof scrubbedParentEnv === 'function');
  process.env.SCRUB_PROBE_SECRET = 'sk-abcdefgh1234567890';
  const env = scrubbedParentEnv();
  delete process.env.SCRUB_PROBE_SECRET;
  ok('scrubbedParentEnv drops secrets', env.SCRUB_PROBE_SECRET === undefined);
  ok('scrubbedParentEnv keeps plain vars', env.PATH !== undefined);
  const { assemblePrompt } = await import('./src/services/PromptAssembly.js');
  const prompt = await assemblePrompt({ convId: 't-int-b140' });
  ok('prompt assembles', typeof prompt === 'string' && prompt.length > 500);
  const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');
  ok('registry stable at 210', TOOL_COUNT === 210);
}

console.log(`\n${failures === 0 ? '🎉 ALL B140 CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
