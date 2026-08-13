/**
 * JEXI OS — stage 26: cross-cutting regression probes.
 *
 * 1. API surface: every /api endpoint the FRONTEND calls must exist as a route
 *    in server/index.js. Catches the classic "new UI → 404" bug at test time.
 * 2. Offline domain probes: deterministic paths that never need an API key —
 *    planner intent detection, offline tool execution, settings round-trip,
 *    verification engine, and the honest degraded path when keys are absent.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { planner } from './src/services/Planner.js';
import { executeTool, getToolCatalog } from './src/services/ToolRuntime.js';
import { detectDomain, verifyDomainAnswer } from './src/services/DomainVerifier.js';
import { loadSettings, saveSettings } from './src/services/SettingsManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { passed++; console.log(`  ✅ ${name}${extra ? ` — ${extra}` : ''}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

/* ------------------------------------------------------------------ */
console.log('\n== API surface: frontend calls ↔ server routes ==');
/* ------------------------------------------------------------------ */
const srcDir = path.join(ROOT, 'src');
const serverFile = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf-8');

function walk(dir, acc = []) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(jsx|js)$/.test(f)) acc.push(full);
  }
  return acc;
}

const frontendFiles = fs.existsSync(srcDir) ? walk(srcDir) : [];
const frontendCalls = new Set();
for (const file of frontendFiles) {
  const text = fs.readFileSync(file, 'utf-8');
  const re = /\/(api\/[a-zA-Z0-9_/.${}()?=&:%#-]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const call = '/' + m[1]
      .replace(/\$\{[^}]*\}/g, ':id')
      .split('?')[0]
      .replace(/\/$/, '')
      .replace(/[.,;:)\]]+$/g, '');
    frontendCalls.add(call);
  }
}

const routeRe = /app\.(get|post|put|delete)\((['"])(\/api\/[^'"]+)\2/g;
const serverRoutes = new Set();
let rm;
while ((rm = routeRe.exec(serverFile))) serverRoutes.add(rm[3].replace(/:([a-zA-Z]+)/g, ':id'));

ok(frontendCalls.size > 0, `frontend calls ${frontendCalls.size} distinct endpoints`);
let missing = 0;
for (const call of frontendCalls) {
  const normalized = call.includes(':id') ? call : call;
  const variants = [normalized, `${normalized}/:id`, `${normalized}/:id/logs`, `${normalized}/:id/stream`, `${normalized}/:id/events`];
  let found = variants.some((v) => serverRoutes.has(v));
  // dynamic action segment (e.g. /api/schedules/:id/pause — the frontend
  // builds it as /api/schedules/${id}/${action}, normalizing to /:id/:id).
  if (!found && normalized.endsWith('/:id/:id')) {
    const prefix = normalized.slice(0, -4);
    found = [...serverRoutes].some((r) => r.startsWith(prefix + '/'));
  }
  if (!found) {
    missing++;
    console.log(`    ✗ missing route for frontend call: ${call}`);
  }
}
ok(missing === 0, `every frontend endpoint has a server route (${frontendCalls.size} checked, ${missing} missing)`);
ok(serverRoutes.size > 50, `server exposes ${serverRoutes.size} routes`);

/* ------------------------------------------------------------------ */
console.log('\n== Planner: deterministic domain detection ==');
/* ------------------------------------------------------------------ */
const probes = [
  ['solve 2x + 5 = 13 for x', 'math_solve'],
  ['research the history of the internet', 'research'],
  ['write a python script to parse csv files', 'code_task'],
  ['what is the latest news about ai', 'news_latest'],
  ['analyze this dataset: rows=[1,2,3]', 'data'],
  ['help me understand quantum entanglement', 'learning_research'],
  ['hello, how are you?', 'conversation'],
];
let planMisses = 0;
for (const [query, expected] of probes) {
  const plan = await planner.analyzeIntent(query);
  if (plan.intent !== expected) { planMisses++; console.log(`    ✗ "${query}" → ${plan.intent}, expected ${expected}`); }
}
ok(planMisses === 0, `${probes.length} intent classifications correct (${planMisses} misses)`);

/* ------------------------------------------------------------------ */
console.log('\n== Domain verification engine ==');
/* ------------------------------------------------------------------ */
const mathAns = await verifyDomainAnswer({ domain: 'math', draft: 'x = 4', query: 'solve 2x + 5 = 13 for x' });
ok(mathAns && ['verified', 'best-effort'].includes(mathAns.verdict), `math answer verdict: ${mathAns?.verdict}`);
const resAns = await verifyDomainAnswer({ domain: 'research', draft: 'The internet began as ARPANET in 1969.', query: 'history of the internet' });
ok(resAns && ['verified', 'best-effort'].includes(resAns.verdict), `research answer verdict: ${resAns?.verdict}`);
ok(Array.isArray(resAns.issues), 'research issues reported as an array');
ok(detectDomain('solve the equation') === 'math', 'detectDomain math');
ok(detectDomain('write me code') === 'code', 'detectDomain code');

/* ------------------------------------------------------------------ */
console.log('\n== Tool runtime: offline tools (no keys needed) ==');
/* ------------------------------------------------------------------ */
const catalog = getToolCatalog();
ok(catalog.length > 100, `tool catalog has ${catalog.length} entries`);

const stats = await executeTool({ slug: 'stats-compute', args: { rows: [[1, 2, 3], [4, 5, 6]], columns: ['a', 'b', 'c'] }, profile: 'full' });
ok(stats.ok === true && stats.result, 'stats-compute runs offline');
ok(stats.permission === 'safe', 'stats-compute classified safe');

const diag = await executeTool({ slug: 'self-diagnose', args: {}, profile: 'full' });
ok(diag.ok === true, 'self-diagnose runs offline');

const bad = await executeTool({ slug: 'web-search', args: {}, profile: 'full' });
ok(bad.ok === false && /missing required arg/.test(bad.error || ''), 'missing required args rejected');

const unknown = await executeTool({ slug: 'no-such-tool', args: {} });
ok(unknown.ok === false, 'unknown tool rejected');

// Risk guard interaction: destructive command blocked even with full profile.
const risky = await executeTool({ slug: 'code-run', args: { command: 'rm -rf /' }, profile: 'full' });
ok(risky.ok === false && risky.byRiskGuard === true, 'RiskGuard blocks rm -rf / even under full profile');

/* ------------------------------------------------------------------ */
console.log('\n== Settings round-trip ==');
/* ------------------------------------------------------------------ */
const s0 = loadSettings();
const orig = { ...s0 };
const round = { ...s0, toolProfile: 'ask' };
saveSettings(round);
const s1 = loadSettings();
ok(s1.toolProfile === 'ask', 'settings persist toolProfile');
saveSettings(orig);
const s2 = loadSettings();
ok(s2.toolProfile === orig.toolProfile, 'settings restored');

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
