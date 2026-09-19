#!/usr/bin/env node
// Phase 11 Scope D — live probes P1–P9 for the internet capability layer.
// Real HTTP where the block demands it (P2/P4/P5); injectable fetch only for
// the anti-bot unit case (P6) — clearly labeled.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ALL_CHANNELS } from '../capability/internet/reach/channels/index.js';
import { WebChannel, AntibotDetectedError } from '../capability/internet/reach/channels/web.channel.js';
import { Channel } from '../capability/internet/reach/channels/base.channel.js';
import { ReachConfig } from '../capability/internet/reach/config.js';
import { read } from '../capability/internet/reach/core.js';
import { checkAll, formatReport } from '../capability/internet/reach/doctor.js';

const ok = (cond, label) => console.log(`${cond ? '✅' : '❌'} ${label}`);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'reach-probe-'));

// ═══ P1 — registry loads; WebChannel is LAST ═══
console.log('════ P1 — registry ════');
for (const [i, ch] of ALL_CHANNELS.entries()) {
  console.log(`  [${i}] name=${ch.name} tier=${ch.tier} backends=${JSON.stringify(ch.backends)} — ${ch.description}`);
  console.log(`      can_handle('https://example.com') = ${ch.can_handle('https://example.com')}`);
  console.log(`      can_handle('custom://something')  = ${ch.can_handle('custom://something')}`);
}
ok(ALL_CHANNELS[ALL_CHANNELS.length - 1].name === 'web', `WebChannel is LAST (index ${ALL_CHANNELS.length - 1} of ${ALL_CHANNELS.length - 1})`);

// ═══ P2 — real URL → web channel (real HTTP) ═══
console.log('\n════ P2 — read https://example.com (real HTTP) ════');
const r2 = await read('https://example.com');
console.log(`routing:    ${JSON.stringify(r2.routing)}`);
console.log(`backend:    ${r2.backend} | bytes: ${r2.bytes} | via: ${r2.via}`);
console.log(`content preview: ${JSON.stringify(r2.content.slice(0, 220))}`);
ok(r2.ok && r2.routing.channel === 'web' && r2.backend === 'Jina Reader', 'served by web channel / Jina Reader');

// ═══ P3 — unknown scheme falls through to WebChannel ═══
console.log('\n════ P3 — read custom://something ════');
try {
  await read('custom://something');
  ok(false, 'should not have succeeded');
} catch (err) {
  console.log(`routed to:  web (can_handle === true — universal fallback)`);
  console.log(`honest failure: [${err.code}] ${String(err.message).slice(0, 200)}`);
  ok(err.code === 'ALL_BACKENDS_FAILED' && String(err.message).includes('custom://something'), 'fell through to WebChannel, failed honestly (no fabricated content)');
}

// ═══ P4 — check() really probes (live) ═══
console.log('\n════ P4 — web.check() live probe ════');
const web = new WebChannel();
const c4 = await web.check();
console.log(`check() → ${JSON.stringify(c4)} | active_backend=${web.active_backend}`);
ok(c4.status === 'ok' && web.active_backend === 'Jina Reader', 'real probe succeeded, active_backend set');

// ═══ P5 — doctor (real, CLI) ═══
console.log('\n════ P5 — doctor --json (CLI, real) ════');
const out5 = execFileSync(process.execPath, [path.join(ROOT, 'capability/internet/reach/doctor.js'), '--json'], { encoding: 'utf8' });
console.log(out5.trim());

// ═══ P6 — anti-bot detection (injected page — labeled) ═══
console.log('\n════ P6 — anti-bot detection ════');
// Jina-Reader-format challenge page (what r.jina.ai returns when the origin
// serves a Cloudflare challenge) — the realistic anti-bot case.
const captchaBody = 'Title: Just a moment...\n\nURL Source: https://blocked.example.com/article\n\nWarning: Requiring captcha — target page protected by Cloudflare.\n\nMarkdown Content:\nVerifying you are human. This may take a few seconds.';
const web6 = new WebChannel();
try {
  await web6.read('https://blocked.example.com/article', {
    get: (k) => (k === 'read_timeout_ms' ? 5000 : 1024 * 1024),
    channelBackend: () => null,
    fetchImpl: async () => ({ status: 200, headers: {}, body: captchaBody, truncated: false }),
  });
  ok(false, 'captcha page MUST NOT be returned as content');
} catch (err) {
  console.log(`error code: [${err.code}]`);
  console.log(`error:      ${err.message}`);
  ok(err instanceof AntibotDetectedError && err.code === 'ANTIBOT_DETECTED', 'specific ANTIBOT_DETECTED error — page content refused');
}

// ═══ P7 — config override ═══
console.log('\n════ P7 — config override web_backend=xyz ════');
const cfg7 = new ReachConfig(path.join(TMP, 'config.yaml'));
cfg7.set('web_backend', 'xyz');
console.log(`config file (${cfg7.filePath}): ${fs.readFileSync(cfg7.filePath, 'utf8').trim().replace(/\n/g, ' | ')}`);
const r7 = await read('https://example.com', { config: cfg7 });
console.log(`ordered attempt chain: ${JSON.stringify(r7.attempts.map((a) => ({ backend: a.backend, ok: a.ok })))}`);
console.log(`override record: ${JSON.stringify(r7.override)}`);
console.log(`final backend:   ${r7.backend}`);
ok(r7.override?.applied === true && r7.override?.value === 'xyz' && r7.attempts[0].backend === 'xyz', 'override applied — xyz tried first (honest BACKEND_NOT_FOUND), chain fell through to Jina Reader');

// ═══ P8 — env override ═══
console.log('\n════ P8 — env override WEB_BACKEND=xyz ════');
process.env.WEB_BACKEND = 'xyz';
const cfg8 = new ReachConfig(path.join(TMP, 'config2.yaml'));
console.log(`cfg.get('web_backend') = ${JSON.stringify(cfg8.get('web_backend'))} (source: ${cfg8.sourceOf('web_backend')})`);
const web8 = new WebChannel();
const ob8 = web8.ordered_backends(cfg8);
console.log(`ordered_backends → ${JSON.stringify(ob8)}`);
ok(ob8.applied && ob8.list[0] === 'xyz' && cfg8.sourceOf('web_backend') === 'env', 'env override applied (WEB_BACKEND → first attempt)');
delete process.env.WEB_BACKEND;

// ═══ P9 — exception isolation in doctor ═══
console.log('\n════ P9 — exception isolation ════');
class BrokenChannel extends Channel {
  name = 'broken';
  description = 'channel whose check() throws';
  backends = ['Nothing'];
  can_handle() { return false; }
  async check() { throw new Error('exploded on purpose (probe)'); }
}
const results9 = await checkAll(new ReachConfig(path.join(TMP, 'config3.yaml')), { channels: [new BrokenChannel(), new WebChannel()] });
console.log(JSON.stringify(results9, null, 2));
ok(results9.broken.status === 'error' && results9.broken.active_backend === null, 'broken channel → isolated error entry');
ok(results9.web.status === 'ok', 'web channel still checked and healthy — doctor did not go down');
console.log('\n' + formatReport(results9));

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\nALL P1–P9 DONE');
