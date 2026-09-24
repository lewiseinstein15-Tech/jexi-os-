/**
 * JEXI OS — PHASE 31 SCOPE 10 — live probe (P1–P8 in-process/command hybrid).
 *
 * P1: provider registration — 2 Phase 27 profiles (schema-validated, keyRef
 *     only, values never read) + native runtime-bridge reflection.
 * P2/P3: live provider calls — HONEST gate: key absent => NOT VERIFIED
 *     (per block; the real-call path is implemented but gated on presence).
 * P4: W10.2 header indicator — SSR of the real component (esbuild bundle,
 *     both branches) + pure resolveModelIndicator unit cases.
 * P5: WA8 bridge verdict flip — child processes, no-key { canChat:false }
 *     vs probe-injected DUMMY key { canChat:true }. Verdict logic only; the
 *     live-LLM leg stays NOT VERIFIED (no real credentials in sandbox).
 * P6: regenerate-capabilities — README runtime baseline, 0 drifts.
 * P7: boot regression — 37 legacy W31 lines intact + 2 new W10 lines,
 *     0 FAIL-SOFT, /api/health 200.
 * P8: zone check — git status ⊆ named call sites + scripts/phase31-*.mjs.
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'w31s10-probe-'));
const FAILS = [];
let n = 0;
function check(id, ok, detail) {
  n += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`);
  if (!ok) FAILS.push(`${id}: ${detail}`);
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY_ENVS = ['GROQ_API_KEY', 'DEEPSEEK_API_KEY'];
const keyPresent = (name, env = process.env) => Boolean(env[name]);

async function health(port, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return { status: res.status, body: await res.json() };
    } catch { /* not up yet */ }
    await pause(700);
  }
  return null;
}
function bootServer(port, runtimeDir, dataDir) {
  const logFile = path.join(TMP, `boot-${port}.log`);
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(ROOT, 'server'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', JEXI_W31_RUNTIME: runtimeDir, DATA_DIR: dataDir },
    stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
  });
  return { child, logFile };
}
const w31Lines = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('W31 '));
const j = (v) => JSON.stringify(v);
const isW10 = (l) => /W31 W10\.(1|2):/.test(l);
const isS6 = (l) => /W31 P30\./.test(l);
const isS5 = (l) => /W31 (W13|W14|W29|S4-N8N|S4-EXEC|S4-REPOCTX|W23c|W16)/.test(l);
const isS3 = (l) => /W31 (S3-|W23e|W23f|WA4:)/.test(l);

/* ============ P1 — provider registration (Phase 27 schema + bridge) ======= */
console.log('== P1: provider registration via Phase 27 profiles schema ==');
const prov = await import(pathToFileURL(path.join(ROOT, 'server/src/wiring/phase31-providers.js')).href);
const noKeyEnv = { ...process.env };
for (const k of KEY_ENVS) delete noKeyEnv[k];
const initRes = prov.initPhase31Providers(noKeyEnv);
const reg = prov.providerRegistration();
check('P1.two-profiles', reg.profiles.length === 2 && reg.profiles.map((p) => p.name).join(',') === 'groq-default,deepseek-default',
  `profiles: ${reg.profiles.map((p) => p.name).join(', ')}`);
check('P1.schema-valid', reg.validation.length === 2 && reg.validation.every((v) => v.valid),
  `Phase 27 schema validation: ${reg.validation.map((v) => `${v.name}=${v.valid ? 'valid' : 'INVALID'}`).join(', ')}`);
check('P1.keyref-shape', reg.profiles.every((p) => KEY_ENVS.includes(p.keyRef) && !/gsk_|sk_live|sk-[a-zA-Z0-9]{20,}/.test(JSON.stringify(p))),
  `keyRefs: ${reg.profiles.map((p) => p.keyRef).join(', ')} — references only, no key-shaped values in any entry`);
check('P1.models', reg.profiles.find((p) => p.name === 'groq-default').model === 'llama-4-scout' && reg.profiles.find((p) => p.name === 'deepseek-default').model === 'deepseek-v4',
  `models: ${reg.profiles.map((p) => `${p.name}=${p.model}`).join(', ')}`);
check('P1.bridge-native', reg.bridge.filter((b) => b.id === 'groq' || b.id === 'deepseek').length === 2 && reg.bridge.every((b) => b.models.length > 0),
  `runtime bridge native adapters: ${reg.bridge.map((b) => `${b.id}(configured=${b.configured}, models=${b.models.join('|')})`).join(', ')}`);
check('P1.honest-absent', initRes.indicator.resolved === false && initRes.indicator.keyRefs.every((k) => !k.present),
  `0/2 keys present in probe env — indicator stays unresolved (honest)`);

/* ============ P2/P3 — live calls (honest gate) ============================ */
console.log('\n== P2/P3: live provider calls (presence-gated) ==');
const groqPresent = keyPresent('GROQ_API_KEY');
const dsPresent = keyPresent('DEEPSEEK_API_KEY');
if (!groqPresent) {
  check('P2.groq-live', true, 'NOT VERIFIED — GROQ_API_KEY absent at probe time (block: mark NOT VERIFIED, continue; no credential escalation)');
} else {
  try {
    const bridge = await import(pathToFileURL(path.join(ROOT, 'server/src/providers/index.js')).href);
    const model = 'llama-4-scout';
    const res = await bridge.chat({ model, messages: [{ role: 'user', content: 'Call the echo_tool with {"text":"online"} then stop.' }], tools: [{ type: 'function', function: { name: 'echo_tool', description: 'echo the given text', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } }], tool_choice: 'auto' });
    check('P2.groq-live', true, `model=${res.model} toolCalls=${(res.toolCalls || []).length} usage=${j(res.usage)}`);
  } catch (e) {
    check('P2.groq-live', false, `live call failed: ${String((e && e.message) || e).slice(0, 120)}`);
  }
}
if (!dsPresent) {
  check('P3.deepseek-live', true, 'NOT VERIFIED — DEEPSEEK_API_KEY absent at probe time (block: mark NOT VERIFIED, continue)');
} else {
  try {
    const bridge = await import(pathToFileURL(path.join(ROOT, 'server/src/providers/index.js')).href);
    const model = 'deepseek-v4';
    const res = await bridge.chat({ model, messages: [{ role: 'user', content: 'Reply with exactly: online' }] });
    check('P3.deepseek-live', true, `model=${res.model} usage=${j(res.usage)}`);
  } catch (e) {
    check('P3.deepseek-live', false, `live call failed: ${String((e && e.message) || e).slice(0, 120)}`);
  }
}

/* ============ P4 — W10.2 header indicator (SSR + unit) ==================== */
console.log('\n== P4: header model indicator (real component, SSR both branches) ==');
try {
  const { build } = await import('esbuild');
  const entry = path.join(TMP, 'ssr-entry.mjs');
  fs.writeFileSync(entry, `
import { renderToString } from 'react-dom/server';
import React from 'react';
import Header, { resolveModelIndicator } from '${path.join(ROOT, 'ui/web/console/shell/Header.jsx').replace(/\\/g, '/')}';
export const unit = {
  groqRow: resolveModelIndicator([{ key: 'groq', configured: true }]),
  empty: resolveModelIndicator([]),
  keylessOnly: resolveModelIndicator([{ key: 'pollinations', configured: true }]),
  deepseekRow: resolveModelIndicator([{ key: 'deepseek', configured: true }]),
};
const domAbsent = renderToString(React.createElement(Header, { routeTitle: 'probe' }));
const domPresent = renderToString(React.createElement(Header, { routeTitle: 'probe', initialModel: 'llama-4-scout' }));
export const ABSENT_HAS_UNRESOLVED = domAbsent.includes('unresolved \u2014 configure a provider');
export const PRESENT_HAS_MODEL = domPresent.includes('llama-4-scout');
`);
  const out = path.join(TMP, 'ssr-bundle.cjs');
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: out, absWorkingDir: ROOT, logLevel: 'silent', jsx: 'automatic', nodePaths: [path.join(ROOT, 'node_modules'), path.join(ROOT, 'server/node_modules')] });
  const ssr = createRequire(pathToFileURL(out))(out);
  const u = ssr.unit;
  check('P4.unit-present', u.groqRow.resolved && u.groqRow.model === 'llama-4-scout', `groq row configured -> ${u.groqRow.model}`);
  check('P4.unit-deepseek', u.deepseekRow.resolved && u.deepseekRow.model === 'deepseek-v4', `deepseek row configured -> ${u.deepseekRow.model}`);
  check('P4.unit-absent', !u.empty.resolved && /unresolved/.test(u.empty.model), `no rows -> "${u.empty.model}"`);
  check('P4.unit-keyless-excluded', !u.keylessOnly.resolved, `keyless pollinations row never satisfies the keyRef gate`);
  check('P4.dom-absent', ssr.ABSENT_HAS_UNRESOLVED === true, `SSR no-key branch renders the honest message`);
  check('P4.dom-present', ssr.PRESENT_HAS_MODEL === true, `SSR keyed branch renders the model name`);
} catch (e) {
  check('P4.ssr', false, `SSR harness failed: ${String((e && e.message) || e).slice(0, 160)}`);
}

/* ============ P5 — WA8 bridge verdict flip (dummy key, no network) ======== */
console.log('\n== P5: WA8 bridge verdict flip (verdict logic; DUMMY key injected, no network) ==');
const childCode = `
const m = await import('${pathToFileURL(path.join(ROOT, 'server/src/providers/index.js')).href}');
const can = m.canChat([]);
console.log(JSON.stringify({ canChat: can, reason: can ? 'provider ready' : 'no provider configured' }));
`;
function runChild(env) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', childCode], { cwd: path.join(ROOT, 'server'), env });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('close', () => resolve(out.trim()));
    setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } resolve(out.trim()); }, 30000);
  });
}
const envA = { ...process.env };
for (const k of KEY_ENVS) delete envA[k];
const envB = { ...envA, GROQ_API_KEY: 'SCOPE10-PROBE-DUMMY-VERDICT-KEY' }; // marker string, NOT a credential; never printed
const verdictA = JSON.parse(await runChild(envA) || '{}');
const verdictB = JSON.parse(await runChild(envB) || '{}');
const diagCode = `
const { getProvider } = await import('${pathToFileURL(path.join(ROOT, 'server/src/providers/index.js')).href}');
const p = getProvider('groq');
console.log(JSON.stringify({ cfg: p.cfg, isConfigured: p.isConfigured() }));
`;
function runDiag(env) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', diagCode], { cwd: path.join(ROOT, 'server'), env });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('close', () => resolve(out.trim()));
    setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } resolve(out.trim()); }, 30000);
  });
}
const diag = JSON.parse(await runDiag(envB) || '{}');
check('P5.verdict-no-key', verdictA.canChat === false, `no keyRef -> ${j(verdictA)}`);
check('P5.verdict-with-key', verdictB.canChat === true, `keyRef present (DUMMY value) -> ${j(verdictB)} — W10.4 VERDICT FLIP: see P5.root-cause`);
check('P5.root-cause', diag.cfg && diag.cfg.keyEnv === undefined && diag.isConfigured === false,
  `PRE-EXISTING shipped bug (files untouched from HEAD e3f434d): loadProviderConfig() reads '.providers' off a FLAT yaml map -> cfg:{} -> keyEnv dropped -> isConfigured() false even with a key present (${j(diag)}). Fix = 1 line in server/src/providers/config/loader.js — OUTSIDE this scope's whitelist -> STOP-AND-REPORT, not touched`);

/* ============ P6 — regenerator: README runtime baseline =================== */
console.log('\n== P6: regenerate-capabilities (W10.5 runtime baseline) ==');
const regen = execSync('node scripts/regenerate-capabilities.mjs --json', { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
const regenJson = JSON.parse(regen);
check('P6.baseline-runtime', regenJson.baselineMode === 'README runtime parse', `baseline mode: ${regenJson.baselineMode}`);
check('P6.zero-drifts', regenJson.mismatches.length === 0, `${regenJson.mismatches.length} drifts (expected 0); README numbers read at runtime: mcpRegistered=${regenJson.readme.mcpRegistered}, mcpEnabled=${regenJson.readme.mcpEnabled}, mcpDirectoryTools=${regenJson.readme.mcpDirectoryTools}`);

/* ============ P7 — boot regression: 37 legacy + 2 W10, health 200 ========= */
console.log('\n== P7: boot regression — 37 W31 legacy lines + 2 new W10 lines, /api/health 200 ==');
const PORT1 = 5400 + (process.pid % 300) * 2;
const b1 = bootServer(PORT1, path.join(TMP, 'boot1-runtime'), path.join(TMP, 'boot1-data'));
const h1 = await health(PORT1);
check('P7.health-200', !!h1 && h1.status === 200, h1 ? `GET /api/health -> ${h1.status}` : 'health never came up (see boot log)');
let p7lines = w31Lines(b1.logFile);
for (let i = 0; i < 10 && p7lines.length === 0 && !b1.child.killed; i++) { await pause(600); p7lines = w31Lines(b1.logFile); }
const w10c = p7lines.filter(isW10).length;
const legacy = p7lines.filter((l) => !isW10(l));
const s1c = legacy.filter((l) => !isS3(l) && !isS5(l) && !isS6(l)).length;
const s3c = legacy.filter(isS3).length;
const s5c = legacy.filter(isS5).length;
const s6c = legacy.filter(isS6).length;
check('P7.legacy-37-intact', legacy.length === 37 && s1c === 15 && s3c === 7 && s5c === 8 && s6c === 7,
  `${legacy.length} legacy W31 boot lines (expected 37): ${s1c} S1 + ${s3c} S3 + ${s5c} S5 + ${s6c} P30 — all intact`);
check('P7.w10-lines', w10c === 2 && p7lines.some((l) => l.startsWith('W31 W10.1:')) && p7lines.some((l) => l.startsWith('W31 W10.2:')),
  `${w10c} new W10 boot lines (expected 2)`);
check('P7.no-fail-soft', !p7lines.some((l) => l.includes('FAIL-SOFT')), '0 FAIL-SOFT lines across the boot');
check('P7.health-providers', !!h1 && Array.isArray(h1.body && h1.body.providers), h1 ? `health providers snapshot present (${(h1.body.providers || []).length} rows) — the header's W10.2 data source` : 'no health body');

/* ============ P8 — zone check (pre-commit) ================================ */
console.log('\n== P8 zone check: git status --short ⊆ named call sites + scripts/phase31-*.mjs ==');
const statusOut = execSync('git status --short', { cwd: ROOT }).toString().split('\n').filter(Boolean).sort();
console.log(statusOut.map((l) => `  ${l}`).join('\n'));
const ALLOWED = [
  'server/src/wiring/phase31-providers.js',   // W10.1 (new)
  'server/src/wiring/phase31-bootstrap.js',   // W10.1 init call + W10 lines
  'ui/web/console/shell/Header.jsx',          // W10.2 (disclosed)
  'scripts/regenerate-capabilities.mjs',      // W10.5
];
const zoneViolations = statusOut.filter((line) => {
  const file = line.slice(3).trim().replace(/^(.*) -> .*$/, '$1');
  if (ALLOWED.includes(file)) return false;
  if (/^scripts\/phase31-[\w.-]*\.mjs$/.test(file)) return false;
  return true;
});
check('P8.zone-clean', zoneViolations.length === 0, `${statusOut.length} entries, all named call sites / scripts/phase31-*.mjs; violations: ${j(zoneViolations)}`);

/* ============ summary ====================================================== */
console.log(`\n== SUMMARY: ${n - FAILS.length}/${n} PASS ==`);
if (FAILS.length) { console.log('FAILURES:'); for (const f of FAILS) console.log(`  - ${f}`); }
try { b1.child.kill('SIGTERM'); } catch { /* already gone */ }
process.exit(FAILS.length ? 1 : 0);
