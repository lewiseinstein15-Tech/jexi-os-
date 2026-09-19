#!/usr/bin/env node
/**
 * phase-17 Scope J probe — Ollama exposure detection (P1–P10).
 * RAW output. Real socket binds where the sandbox allows; honest
 * NOT VERIFIED where it does not. Zone: scripts/phase17-*.mjs.
 */
import net from 'node:net';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import { checkBind, startupNotice, isExposureAllowed } from '../security/shield/inference-exposure.js';
import { OllamaProvider, OllamaExposureError } from '../providers/adapters/ollama.provider.js';

const results = [];
const verdict = (id, name, ok, evidence, status) => {
  const s = status || (ok ? 'PASS' : 'FAIL');
  results.push({ id, name, status: s });
  console.log(`\n[P${id}] ${name} → ${s}`);
  console.log(evidence);
};

const captureLogger = () => {
  const cap = { warnings: [], errors: [], infos: [] };
  return {
    warnings: cap.warnings,
    errors: cap.errors,
    infos: cap.infos,
    warn: (...a) => cap.warnings.push(a.join(' ')),
    error: (...a) => cap.errors.push(a.join(' ')),
    info: (...a) => cap.infos.push(a.join(' ')),
    log: () => {},
  };
};

const listen = (port, host) => new Promise((resolve, reject) => {
  const srv = net.createServer(() => {});
  srv.once('error', reject);
  srv.listen(port, host, () => resolve(srv));
});
const close = (srv) => new Promise((r) => srv.close(() => r()));

// ── P1 — checkBind loopback ──────────────────────────────────────────────────
{
  const v = checkBind('127.0.0.1', 11434);
  verdict(1, "checkBind('127.0.0.1', 11434)", v.exposed === false && v.risk === 'low', JSON.stringify(v, null, 2));
}

// ── P2 — checkBind public wildcard ───────────────────────────────────────────
{
  const v = checkBind('0.0.0.0', 11434);
  verdict(2, "checkBind('0.0.0.0', 11434)", v.exposed === true && v.risk === 'high' && !!v.reason, JSON.stringify(v, null, 2));
}

// ── P3 — checkBind IPv6 any ──────────────────────────────────────────────────
{
  const v = checkBind('::', 11434);
  verdict(3, "checkBind('::', 11434)", v.exposed === true, JSON.stringify(v, null, 2));
}

// ── P4 — provider refuses public bind without flag ──────────────────────────
{
  const logger = captureLogger();
  let thrown = null;
  try {
    await new OllamaProvider({ host: '0.0.0.0', port: 11434 }, {}, logger).init();
  } catch (e) { thrown = e; }
  const ok = thrown instanceof OllamaExposureError && thrown.code === 'E_OLLAMA_EXPOSED' && logger.errors.some((l) => l === startupNotice('0.0.0.0'));
  verdict(4, 'init host=0.0.0.0, no ALLOW_OLLAMA_EXPOSED → throws OllamaExposureError', ok,
    `thrown=${thrown ? thrown.name : 'nothing'} code=${thrown?.code}\nerror-log: ${logger.errors[0] || '∅'}\nverdict.risk=${thrown?.verdict?.risk}`);
}

// ── P5 — provider allows with ALLOW_OLLAMA_EXPOSED=1 (WARNING) ───────────────
{
  const logger = captureLogger();
  let started = null, err = null;
  try { started = await new OllamaProvider({ host: '0.0.0.0', port: 11434 }, { ALLOW_OLLAMA_EXPOSED: '1' }, logger).init(); }
  catch (e) { err = e; }
  const warned = logger.warnings.some((l) => l.startsWith('WARNING:') && l === `WARNING: ${startupNotice('0.0.0.0')}`);
  verdict(5, "init host=0.0.0.0 + ALLOW_OLLAMA_EXPOSED=1 → starts with WARNING", !!started && started.initialized === true && warned && !err,
    `initialized=${started?.initialized}\nwarning-log: ${logger.warnings[0] || '∅'}${err ? `\nunexpected: ${err.name}` : ''}`);
}

// ── P6 — provider default is loopback, no warning ────────────────────────────
{
  const logger = captureLogger();
  const p = new OllamaProvider({}, {}, logger);
  await p.init();
  const v = p.exposure();
  const ok = p.host === '127.0.0.1' && v.exposed === false && logger.warnings.length === 0 && logger.errors.length === 0;
  verdict(6, 'init with no host config → binds 127.0.0.1, no warning', ok,
    JSON.stringify(p.config(), null, 2) + `\nwarnings=${logger.warnings.length} errors=${logger.errors.length}`);
}

// ── P7 — real socket binds ───────────────────────────────────────────────────
{
  const lines = [];
  let ok = true;
  try {
    const s1 = await listen(11434, '127.0.0.1');
    const addr1 = s1.address();
    const v1 = checkBind(addr1.address, addr1.port);
    const good1 = v1.exposed === false && v1.risk === 'low';
    ok = ok && good1;
    lines.push(`bind 127.0.0.1:11434 → listening, address()=${addr1.address}:${addr1.port}\ncheckBind → ${JSON.stringify(v1)} ${good1 ? 'OK' : 'BAD'}`);
    await close(s1);

    const s2 = await listen(11434, '0.0.0.0');
    const addr2 = s2.address();
    const v2 = checkBind(addr2.address, addr2.port);
    const good2 = v2.exposed === true && v2.risk === 'high';
    ok = ok && good2;
    lines.push(`bind 0.0.0.0:11434 → listening, address()=${addr2.address}:${addr2.port}\ncheckBind → ${JSON.stringify(v2)} ${good2 ? 'OK' : 'BAD'}`);
    await close(s2);
  } catch (e) {
    ok = false;
    lines.push(`socket error: ${e.message} → NOT VERIFIED`);
  }
  verdict(7, 'real socket binds classified by checkBind', ok, lines.join('\n'), ok ? undefined : (/socket error/.test(lines.join('')) ? 'NOT VERIFIED' : undefined));
}

// ── P8 — unusual bind: sandbox's own non-loopback interface ─────────────────
{
  const ifaces = os.networkInterfaces();
  const lan = Object.entries(ifaces).flatMap(([name, addrs]) => (addrs || [])
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .map((a) => ({ name, address: a.address })));
  if (!lan.length) {
    verdict(8, 'unusual (non-loopback) bind detected as exposed', false,
      `non-loopback IPv4 interfaces found: 0 → ${JSON.stringify(ifaces)}\nP8 NOT VERIFIED — sandbox has no external interface to bind`, 'NOT VERIFIED');
  } else {
    const pick = lan.find((l) => /^192\.168\./.test(l.address)) || lan[0];
    const lines = [`interfaces: ${JSON.stringify(lan)}`];
    let ok = false;
    try {
      const srv = await listen(0, pick.address); // ephemeral port on the LAN ip
      const addr = srv.address();
      const v = checkBind(addr.address, addr.port);
      ok = v.exposed === true;
      lines.push(`bind ${addr.address}:${addr.port} (iface ${pick.name}) → listening\ncheckBind → ${JSON.stringify(v)} ${ok ? 'OK' : 'BAD'}`);
      await close(srv);
    } catch (e) {
      lines.push(`socket error on ${pick.address}: ${e.message} → NOT VERIFIED`);
      verdict(8, 'unusual (non-loopback) bind detected as exposed', false, lines.join('\n'), 'NOT VERIFIED');
    }
    if (ok || !/socket error/.test(lines.join(''))) verdict(8, 'unusual (non-loopback) bind detected as exposed', ok, lines.join('\n'));
  }
}

// ── P9 — idempotent + deterministic ──────────────────────────────────────────
{
  const cases = [['127.0.0.1', 11434], ['0.0.0.0', 11434], ['::', 11434], ['192.168.1.50', 11434], ['0.0.0.0', 8080]];
  const a = cases.map(([h, p]) => checkBind(h, p));
  const b = cases.map(([h, p]) => checkBind(h, p));
  let ok = true;
  a.forEach((v, i) => {
    const same = JSON.stringify(v) === JSON.stringify(b[i]);
    ok = ok && same;
  });
  ok = ok && isExposureAllowed({ ALLOW_OLLAMA_EXPOSED: '1' }) === true && isExposureAllowed({ ALLOW_OLLAMA_EXPOSED: 'true' }) === false && isExposureAllowed({}) === false;
  verdict(9, 'same inputs → same verdict twice; strict opt-in parsing', ok,
    cases.map(([h, p], i) => `checkBind('${h}', ${p}) = ${JSON.stringify(a[i])}`).join('\n') +
    `\nALLOW_OLLAMA_EXPOSED: '1'→${isExposureAllowed({ ALLOW_OLLAMA_EXPOSED: '1' })} 'true'→${isExposureAllowed({ ALLOW_OLLAMA_EXPOSED: 'true' })} unset→${isExposureAllowed({})}`);
}

// ── P10 — integration point ──────────────────────────────────────────────────
{
  const grep = execFileSync('grep', ['-n', 'checkBind\\|isExposureAllowed\\|OllamaExposureError\\|127.0.0.1', path.join(ROOT, 'providers/adapters/ollama.provider.js')], { encoding: 'utf8' });
  const wiring = [
    'IN-ZONE (this scope): providers/adapters/ollama.provider.js — init() calls checkBind via this.exposure() (see grep lines above).',
    'ZONE-OWNER TASKS (recorded, NOT actioned — server/** is out of zone):',
    '  1. server/src/providers/adapters/ollama.js — delegate host validation to security/shield/inference-exposure.js#checkBind so OLLAMA_HOST=0.0.0.0 hits the same refusal.',
    '  2. server/index.js — if Ollama is spawned by the server, run OllamaProvider#init()/checkBind before spawn and handle E_OLLAMA_EXPOSED.',
    'Note: security/shield/ssrf.js / dns-guard.js / tls-pin.js (Phase 9) do NOT exist on phase-17-arena at b75bd4f — no coordination conflict possible from this scope.',
  ];
  verdict(10, 'integration point cited (file:line) + zone-owner tasks recorded', !!grep, grep + '\n\n' + wiring.join('\n'));
}

const pass = results.filter((r) => r.status === 'PASS').length;
const nv = results.filter((r) => r.status === 'NOT VERIFIED').length;
const fail = results.filter((r) => r.status === 'FAIL').length;
console.log(`\n══════ phase-17 Scope J probe: ${pass} PASS / ${fail} FAIL / ${nv} NOT VERIFIED (of ${results.length}) ══════`);
for (const r of results) if (r.status === 'FAIL') console.log(`  FAILED: P${r.id} ${r.name}`);
for (const r of results) if (r.status === 'NOT VERIFIED') console.log(`  NOT VERIFIED: P${r.id} ${r.name}`);
process.exit(fail === 0 ? 0 : 1);
