#!/usr/bin/env node
/**
 * ZONE-OWNER ITEM 2 LIVE PROBE — checkBind wired into the runtime Ollama adapter.
 * Run from repo root:  node scripts/zone-owner-item2-probe.mjs
 * Proves:
 *   1. init() with host=0.0.0.0, no flag → throws OllamaExposureError (E_OLLAMA_EXPOSED)
 *   2. init() with ALLOW_OLLAMA_EXPOSED=1 → starts, WARNING logged
 *   3. init() with default (loopback) → silent success
 *   4. REAL socket binds on 0.0.0.0 and 127.0.0.1 are detected through the adapter
 *   5. chat()/stream() enforce lazily — a public OLLAMA_HOST refuses at first call
 *   6. consolidation — providers/adapters/ollama.provider.js is GONE; the runtime
 *      adapter is canonical; phase17-j historical probe imports it.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OllamaAdapter, OllamaExposureError } from '../server/src/providers/adapters/ollama.js';
import { startupNotice, checkBind } from '../security/shield/inference-exposure.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0; let checks = 0;
const check = (label, cond, detail = '') => {
  checks++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fails++;
};
const captureLogger = () => {
  const cap = { warnings: [], errors: [] };
  return { cap, warn: (...a) => cap.warnings.push(a.join(' ')), error: (...a) => cap.errors.push(a.join(' ')), log: () => {}, info: () => {} };
};
const listen = (host) => new Promise((resolve, reject) => {
  const srv = net.createServer(() => {});
  srv.once('error', reject);
  srv.listen(0, host, () => resolve(srv));
});
const close = (srv) => new Promise((r) => srv.close(() => r()));

// ---- 1. public bind, no flag → refusal
{
  const logger = captureLogger();
  let thrown = null;
  try { new OllamaAdapter({ host: '0.0.0.0', port: 11434 }, {}, logger).init(); } catch (e) { thrown = e; }
  check('init host=0.0.0.0 no flag → throws OllamaExposureError',
    thrown instanceof OllamaExposureError && thrown.code === 'E_OLLAMA_EXPOSED' && thrown.verdict?.exposed === true,
    `thrown=${thrown?.name ?? 'nothing'} code=${thrown?.code} risk=${thrown?.verdict?.risk}`);
  check('refusal logs the exact startupNotice line',
    logger.cap.errors.some((l) => l === startupNotice('0.0.0.0')),
    `error-log: ${logger.cap.errors[0] || '∅'}`);
}

// ---- 2. public bind WITH ALLOW_OLLAMA_EXPOSED=1 → starts with WARNING
{
  const logger = captureLogger();
  let started = null; let err = null;
  try { started = new OllamaAdapter({ host: '0.0.0.0', port: 11434 }, { ALLOW_OLLAMA_EXPOSED: '1' }, logger).init(); } catch (e) { err = e; }
  const warned = logger.cap.warnings.some((l) => l === `WARNING: ${startupNotice('0.0.0.0')}`);
  check('init host=0.0.0.0 + ALLOW_OLLAMA_EXPOSED=1 → starts with WARNING',
    !!started && started.initialized === true && warned && !err,
    `initialized=${started?.initialized} warning-log: ${logger.cap.warnings[0] || '∅'}${err ? ` unexpected:${err.name}` : ''}`);
}

// ---- 3. default bind → loopback, silent success
{
  const logger = captureLogger();
  const a = new OllamaAdapter({}, {}, logger);
  a.init();
  const v = a.exposure();
  check('init with no host config → 127.0.0.1 loopback, silent success',
    a.host === '127.0.0.1' && v.exposed === false && a.initialized === true &&
    logger.cap.warnings.length === 0 && logger.cap.errors.length === 0,
    `host=${a.host} port=${a.port} exposed=${v.exposed} warnings=${logger.cap.warnings.length} errors=${logger.cap.errors.length}`);
}

// ---- 4. REAL socket binds, detected through the adapter
{
  const lines = [];
  let ok = true;
  try {
    const sLoop = await listen('127.0.0.1');
    const addrLoop = sLoop.address();
    const aLoop = new OllamaAdapter({ baseUrl: `http://127.0.0.1:${addrLoop.port}/v1` }, {}, captureLogger());
    const vLoop = aLoop.exposure();
    ok = ok && vLoop.exposed === false;
    lines.push(`real bind 127.0.0.1:${addrLoop.port} → adapter exposure ${JSON.stringify(vLoop)}`);
    await close(sLoop);

    const sPub = await listen('0.0.0.0');
    const addrPub = sPub.address(); // 0.0.0.0 wildcard confirmed by the kernel
    const loggerPub = captureLogger();
    const aPub = new OllamaAdapter({ baseUrl: `http://${addrPub.address}:${addrPub.port}/v1` }, {}, loggerPub);
    const vPub = aPub.exposure();
    let threwOnReal = null;
    try { aPub.init(); } catch (e) { threwOnReal = e; }
    ok = ok && vPub.exposed === true && threwOnReal instanceof OllamaExposureError;
    lines.push(`real bind ${addrPub.address}:${addrPub.port} → adapter exposure ${JSON.stringify(vPub)}; init threw=${threwOnReal?.name}(${threwOnReal?.code})`);
    await close(sPub);
  } catch (e) {
    ok = false;
    lines.push(`socket error: ${e.message}`);
  }
  check('real socket binds (loopback + wildcard) detected via adapter.exposure()/init()', ok, lines.join(' | '));
}

// ---- 5. lazy runtime enforcement: OLLAMA_HOST=0.0.0.0 refuses at first chat()
{
  const logger = captureLogger();
  const a = new OllamaAdapter({}, { OLLAMA_HOST: '0.0.0.0:11434' }, logger); // bare host:port form
  let chatErr = null;
  try { await a.chat({ messages: [{ role: 'user', content: 'hi' }], model: 'llama3.1' }); } catch (e) { chatErr = e; }
  check('OLLAMA_HOST=0.0.0.0:11434 (bare form) → chat() refuses with E_OLLAMA_EXPOSED before any network I/O',
    chatErr instanceof OllamaExposureError && chatErr.code === 'E_OLLAMA_EXPOSED' && a.host === '0.0.0.0' && a.port === 11434,
    `host=${a.host} port=${a.port} chatErr=${chatErr?.name}(${chatErr?.code})`);
  let streamErr = null;
  const a2 = new OllamaAdapter({}, { OLLAMA_HOST: 'http://0.0.0.0:11434' }, captureLogger());
  try { for await (const _ of a2.stream({ messages: [], model: 'llama3.1' })) { /* unreachable */ } } catch (e) { streamErr = e; }
  check('stream() enforces the same guard', streamErr instanceof OllamaExposureError, `streamErr=${streamErr?.name}(${streamErr?.code})`);
}

// ---- 6. consolidation evidence
{
  const gone = !fs.existsSync(path.join(ROOT, 'providers/adapters/ollama.provider.js'));
  const probeSrc = fs.readFileSync(path.join(ROOT, 'scripts/phase17-j-probe.mjs'), 'utf-8');
  const repointed = probeSrc.includes("from '../server/src/providers/adapters/ollama.js'") && !probeSrc.includes("ollama.provider.js'");
  const canonical = /checkBind/.test(fs.readFileSync(path.join(ROOT, 'server/src/providers/adapters/ollama.js'), 'utf-8'));
  check('standalone duplicate providers/adapters/ollama.provider.js REMOVED', gone);
  check('phase17-j historical probe repointed to canonical adapter', repointed);
  check('canonical adapter calls checkBind from security/shield/inference-exposure.js', canonical);
  // sanity: checkBind itself untouched (shield is shared, not modified)
  check('shared shield semantics unchanged (0.0.0.0:11434 → exposed/high)', JSON.stringify(checkBind('0.0.0.0', 11434)) === JSON.stringify({ exposed: true, risk: 'high', reason: checkBind('0.0.0.0', 11434).reason }));
}

console.log(`\n===== PROBE TALLY: ${checks} checked, ${checks - fails} pass, ${fails} fail =====`);
process.exit(fails === 0 ? 0 : 1);
