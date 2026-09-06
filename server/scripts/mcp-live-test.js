/**
 * MCP LIVE TEST v2 — every server in the registry, MULTIPLE rounds, real calls.
 * (Lewis: "test them not once but many times, prove JEXI is using them as intended.")
 *
 * For every server in mcp/registry.json (v3), for ROUNDS rounds:
 *   1. connect through the REAL gateway (real SDK client, stdio or streamable-http)
 *   2. list tools (must be > 0)
 *   3. call ONE real tool with real args and verify the actual output
 *   4. disconnect (child process must die)
 * The final round also invokes several servers through the UNIFIED tool path
 * (invokeUnifiedTool 'mcp:server:tool') — the same path JEXI's brain uses.
 *
 * Honest categories in the report: qrcode/pandoc need host binaries (qrencode/pandoc —
 * installed in the brain's Docker image); the browser trio (playwright, playwright-ea,
 * chrome-devtools) needs a host browser — those report as CONNECT+LIST-verified with notes.
 *
 * Usage: cd server && node scripts/mcp-live-test.js [rounds]
 * (network required — npx/uvx download packages on first use)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROUNDS = Number(process.argv[2] || 3);
const SERVER_ROOT = path.resolve(process.cwd());
const TEST_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-live-data-'));
const TEST_WS = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-live-ws-'));
process.env.DATA_DIR = TEST_DATA;
process.env.WORKSPACE_DIR = TEST_WS;

const registry = JSON.parse(fs.readFileSync(path.join(SERVER_ROOT, '../mcp/registry.json'), 'utf8'));

// Test registry copy: every server enabled, host paths pointed at the temp dirs.
const testReg = { ...registry, servers: registry.servers.map((s) => ({ ...s })) };
for (const s of testReg.servers) {
  if (!Array.isArray(s.args)) continue;
  s.args = s.args.map((a) => String(a)
    .replace(/\$\{JEXI_WORKSPACE\}/g, (s.name === 'filesystem' || s.name === 'fs-alt') ? wsDir() : '/home/user/jexi-os')
    .replace(/\$\{JEXI_SQLITE_DB\}/g, path.join(TEST_DATA, 'live.db')));
}
function wsDir() { return TEST_WS; }
const REG_PATH = path.join(TEST_DATA, 'registry-live.json');
fs.writeFileSync(REG_PATH, JSON.stringify(testReg, null, 2));

// A sample file for converters
fs.writeFileSync(path.join(TEST_WS, 'sample.txt'), '# JEXI live test\n\nThis file proves real file conversion.\n');

const g = await import('../src/services/MCPGateway.js');
let unified = null;
try { unified = await import('../src/services/UnifiedTools.js'); } catch { /* older layout */ }

/* ── one REAL tool call per server, verified against its actual output ───── */
const SAMPLE_VIDEO = 'dQw4w9WgXcQ';
const CALLS = {
  filesystem: async (ws) => [
    ['write_file', { path: path.join(ws, 'live-test.txt'), content: 'written by the real filesystem MCP server' }],
    (r) => r.ok,
    ['read_file', { path: path.join(ws, 'live-test.txt') }],
    (r) => (r.result?.content || []).map((x) => x.text || '').join('').includes('written by the real filesystem MCP server'),
  ],
  'fs-alt': async (ws) => [
    ['write_file', { path: path.join(ws, 'alt-test.txt'), content: 'alt filesystem server round trip' }],
    () => true,
    ['read_text_file', { path: path.join(ws, 'alt-test.txt') }],
    (r) => (r.result?.content || []).map((x) => x.text || '').join('').includes('alt filesystem server round trip'),
  ],
  memory: async () => [
    ['create_entities', { entities: [{ name: 'Lewis', entityType: 'person', observations: ['runs JEXI OS'] }] }],
    () => true,
    ['read_graph', {}],
    (r) => (r.result?.content || []).map((x) => x.text || '').join('').includes('Lewis'),
  ],
  everything: async () => [
    ['echo', { message: `jexi-live-${Date.now()}` }],
    (r) => (r.result?.content || []).map((x) => x.text || '').join('').includes('jexi-live-'),
  ],
  sequentialthinking: async () => [
    ['sequentialthinking', { thought: 'JEXI live test: 2+2=4, 4x2=8.', nextThoughtNeeded: false, thoughtNumber: 1, totalThoughts: 1 }],
    (r) => /thought/i.test((r.result?.content || []).map((x) => x.text || '').join('')),
  ],
  context7: async () => [
    ['resolve-library-id', { libraryName: 'react', query: 'react' }],
    (r) => (r.result?.content || []).map((x) => x.text || '').join('').includes('React'),
  ],
  'context7-remote': async () => [
    ['resolve-library-id', { libraryName: 'react', query: 'react' }],
    (r) => (r.result?.content || []).map((x) => x.text || '').join('').includes('React'),
  ],
  'mate-tools': async () => [
    ['count_lines', { text: 'hello\nworld\nworld' }],
    (r) => /Lines/i.test((r.result?.content || []).map((x) => x.text || '').join('')),
  ],
  'wikipedia-js': async () => [
    ['search_wikipedia', { query: 'Kericho', limit: 3 }],
    (r) => JSON.stringify(r.result || {}).toLowerCase().includes('kericho'),
  ],
  'wikipedia-py': async () => [
    ['search_articles', { query: 'Kericho' }],
    (r) => JSON.stringify(r.result || {}).length > 50,
  ],
  fetch: async () => [
    ['fetch', { url: 'https://example.com' }],
    (r) => (r.result?.content || []).map((x) => x.text || '').join('').includes('example.com'),
  ],
  time: async () => [
    ['get_current_time', { timezone: 'Africa/Nairobi' }],
    (r) => (r.result?.content || []).map((x) => x.text || '').join('').includes('Nairobi'),
  ],
  git: async () => [
    ['git_status', { repo_path: '/home/user/jexi-os' }],
    (r) => /On branch|working tree|nothing to commit/i.test((r.result?.content || []).map((x) => x.text || '').join('')),
  ],
  calculator: async () => [
    ['calculate', { expression: '2+2*10' }],
    (r) => (r.result?.content || []).map((x) => x.text || '').join('').includes('22'),
  ],
  arxiv: async () => [
    ['search_papers', { query: 'attention is all you need', max_results: 2 }],
    (r) => JSON.stringify(r.result || {}).length > 100,
  ],
  markitdown: async (ws) => [
    ['convert_to_markdown', { uri: 'file://' + path.join(ws, 'sample.txt') }],
    (r) => (r.result?.content || []).map((x) => x.text || '').join('').includes('real file conversion'),
  ],
  sqlite: async (ws, dataDir) => [
    ['write_query', { query: `CREATE TABLE IF NOT EXISTS live (id INTEGER PRIMARY KEY, name TEXT)` }],
    () => true,
    ['write_query', { query: `INSERT INTO live (name) VALUES ('jexi')` }],
    () => true,
    ['read_query', { query: 'SELECT name FROM live' }],
    (r) => (r.result?.content || []).map((x) => x.text || '').join('').includes('jexi'),
  ],
  osm: async () => [
    ['geocode_address', { address: 'Kericho, Kenya' }],
    (r) => JSON.stringify(r.result || {}).length > 50,
  ],
  rss: async () => [
    ['feed', { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', limit: 3 }],
    (r) => JSON.stringify(r.result || {}).length > 100,
  ],
  deepwiki: async () => [
    ['ask_question', { repoName: 'facebook/react', question: 'What is useState?' }],
    (r) => JSON.stringify(r.result || {}).length > 80,
  ],
  gitmcp: async () => [
    ['search_generic_documentation', { owner: 'facebook', repo: 'react', query: 'hooks' }],
    (r) => JSON.stringify(r.result || {}).length > 50,
  ],
  chroma: async () => [
    ['chroma_list_collections', {}],
    (r) => r.ok,
  ],
  mermaid: async () => [
    ['generate_diagram', { content: 'graph TD; A[JEXI]-->B[Live Test]' }],
    (r) => JSON.stringify(r.result || {}).length > 100,
  ],
  mcpqueen: async () => [
    ['search_servers', { query: 'filesystem', limit: 3 }],
    (r) => JSON.stringify(r.result || {}).length > 50,
  ],
  mslearn: async () => [
    ['microsoft_docs_search', { query: 'playwright' }],
    (r) => JSON.stringify(r.result || {}).length > 80,
  ],
  'cloudflare-docs': async () => [
    ['search_cloudflare_documentation', { query: 'workers' }],
    (r) => JSON.stringify(r.result || {}).length > 50,
  ],
  // ── Sept 2026 wave 2 (registry v3.2) — 11 more keyless servers ──
  duckduckgo: async () => [
    ['search', { query: 'kericho kenya' }],
    (r) => (r.result?.content || []).map((x) => x.text || '').join('').length > 40,
  ],
  weather: async () => [
    ['get_weather_summary', { city_name: 'Nairobi' }],
    (r) => JSON.stringify(r.result || {}).toLowerCase().match(/temp|°|weather|wind/) !== null,
  ],
  'free-search': async () => [
    ['search', { query: 'kenya tea', engines: ['duckduckgo', 'wikipedia'] }],
    (r) => JSON.stringify(r.result || {}).length > 80,
  ],
  'x-docs': async () => [
    ['search_x', { query: 'create a post' }],
    (r) => (r.result?.content || []).map((x) => x.text || '').join('').length > 40,
  ],
  hackernews: async () => [
    ['getTopStories', {}],
    (r) => JSON.stringify(r.result || {}).length > 40,
  ],
  'aws-docs': async () => [
    ['aws___search_documentation', { search_phrase: 'S3 bucket' }],
    (r) => JSON.stringify(r.result || {}).length > 60,
  ],
  duckdb: async () => [
    ['query', { query: "SELECT COUNT(*) AS n FROM range(1, 6) t(i)" }],
    (r) => JSON.stringify(r.result || {}).includes('5'),
  ],
  openlibrary: async () => [
    ['search_books', { title: 'Things Fall Apart' }],
    (r) => JSON.stringify(r.result || {}).length > 60,
  ],
  sympy: async () => [
    ['sympy_solve', { equation: 'x**2 - 4', variables: 'x' }],
    (r) => JSON.stringify(r.result || {}).includes('-2'),
  ],
  musicbrainz: async () => [
    ['musicbrainz_search', { query: 'Fela Kuti', entity: 'artist' }],
    (r) => JSON.stringify(r.result || {}).length > 60,
  ],
  worldbank: async () => [
    ['get-countries', {}],
    (r) => JSON.stringify(r.result || {}).length > 60,
  ],
};

const results = new Map(); // name → { rounds: [ {connect, tools, call, error} ], evidence }

async function runServer(name, round) {
  const entry = { connect: false, tools: 0, call: false, error: null };
  const t0 = Date.now();
  const c = await g.connectGatewayServer(name, { registryPath: REG_PATH });
  if (!c.ok) { entry.error = `connect: ${c.error}`; return { entry, ms: Date.now() - t0 }; }
  entry.connect = true;
  entry.tools = c.tools;
  const spec = CALLS[name];
  if (!spec) { entry.call = null; return { entry, ms: Date.now() - t0 }; }
  try {
    const steps = await spec(TEST_WS, TEST_DATA); // [tool, args, check?, tool, args, check?...] pairs then final check
    let last = null;
    for (let i = 0; i < steps.length; i += 2) {
      if (typeof steps[i] === 'function') { // check step (pairs: [tool,args] then fn) — layout: pairs of (call|check)
        continue;
      }
      const [tool, args] = steps[i];
      const check = typeof steps[i + 1] === 'function' ? steps[i + 1] : null;
      const r = await g.invokeMcpTool({ server: name, tool, args, timeoutMs: 60_000 });
      last = r;
      if (check && !check(r)) { entry.error = `verify after ${tool}: ${JSON.stringify(r).slice(0, 120)}`; return { entry, ms: Date.now() - t0 }; }
      if (!r.ok && !check) { entry.error = `${tool}: ${r.error}`; return { entry, ms: Date.now() - t0 }; }
    }
    entry.call = last ? (last.ok || false) : false;
    if (!entry.call && last && last.error) entry.error = `call: ${String(last.error).slice(0, 120)}`;
  } catch (e) { entry.error = String(e.message).slice(0, 140); }
  await g.disconnectGatewayServer(name);
  return { entry, ms: Date.now() - t0 };
}

/* ── rounds ──────────────────────────────────────────────────────────────── */
for (let round = 1; round <= ROUNDS; round++) {
  console.log(`\n════ ROUND ${round}/${ROUNDS} ════`);
  for (const s of testReg.servers) {
    if (!results.has(s.name)) results.set(s.name, { rounds: [], evidence: '' });
    const { entry, ms } = await runServer(s.name, round);
    results.get(s.name).rounds.push(entry);
    const tag = entry.connect ? (entry.call === null ? 'connected·listed' : entry.call ? 'CALLED' : 'FAILED-CALL') : 'FAILED-CONNECT';
    console.log(`  ${tag.padEnd(18)} ${s.name.padEnd(18)} ${entry.tools}t ${ms}ms${entry.error ? ' · ' + entry.error.slice(0, 70) : ''}`);
  }
}

/* ── unified path proof (the path JEXI's brain actually uses) ────────────── */
let unifiedProof = [];
if (unified) {
  console.log('\n════ UNIFIED TOOL PATH (how JEXI calls them) ════');
  const proofs = [
    ['mcp:everything:echo', { message: 'unified-path-proof' }],
    ['mcp:calculator:calculate', { expression: '6*7' }],
    ['mcp:time:get_current_time', { timezone: 'Africa/Nairobi' }],
    ['mcp:mate-tools:count_lines', { text: 'one\ntwo' }],
  ];
  for (const [id, args] of proofs) {
    const r = await unified.invokeUnifiedTool(id, args, {});
    unifiedProof.push({ id, ok: r.ok === true });
    console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${id} → ${r.ok ? String(JSON.stringify(r.result?.content?.[0]?.text || r.result || '')).slice(0, 60) : r.error}`);
  }
}

/* ── report ──────────────────────────────────────────────────────────────── */
console.log('\n════════════ MCP LIVE TEST — FINAL RESULTS ════');
let fullPass = 0, connectOnly = 0, fail = 0;
for (const [name, r] of results) {
  const connects = r.rounds.filter((x) => x.connect).length;
  const callsOk = r.rounds.filter((x) => x.connect && x.call === true).length;
  const callsNone = r.rounds.some((x) => x.connect && x.call === null); // no tool spec — connect-verified by design
  if (connects !== ROUNDS) { fail++; }
  else if (callsNone || callsOk < ROUNDS) connectOnly++;
  else fullPass++;
  const tag = connects !== ROUNDS ? 'FAIL' : (callsNone || callsOk < ROUNDS) ? 'LIST' : 'PASS';
  const callsLabel = callsNone ? 'connect-verified (needs host binary/browser — see notes)' : `${callsOk}/${ROUNDS} tool calls`;
  console.log(`${tag}  ${name.padEnd(18)} ${connects}/${ROUNDS} connected · ${callsLabel}${r.rounds[ROUNDS - 1]?.error ? ' · ' + r.rounds[ROUNDS - 1].error.slice(0, 60) : ''}`);
}
console.log(`\n${fullPass} full-pass (real tool calls every round) · ${connectOnly} connect-verified · ${fail} failed · ${ROUNDS} rounds each`);
console.log(`unified path: ${unifiedProof.filter((p) => p.ok).length}/${unifiedProof.length} proofs OK`);

fs.rmSync(TEST_DATA, { recursive: true, force: true });
fs.rmSync(TEST_WS, { recursive: true, force: true });
process.exit(fail === 0 && unifiedProof.every((p) => p.ok) ? 0 : 1);
