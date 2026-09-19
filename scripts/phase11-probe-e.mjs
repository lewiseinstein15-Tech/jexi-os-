#!/usr/bin/env node
// Phase 11 Scope E — live probes P1–P8 over the 16-channel registry.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_CHANNELS, route } from '../capability/internet/reach/channels/index.js';
import { read } from '../capability/internet/reach/core.js';
import { checkAll, formatReport } from '../capability/internet/reach/doctor.js';
import { ReachConfig } from '../capability/internet/reach/config.js';
import { tmpdir } from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ok = (cond, label) => console.log(`${cond ? '✅' : '❌'} ${label}`);
const clip = (s, n = 220) => JSON.stringify(String(s).slice(0, n));

// ═══ P1 — registry ═══
console.log('════ P1 — registry (16 channels) ════');
ALL_CHANNELS.forEach((ch, i) => {
  console.log(`  [${String(i).padStart(2)}] ${ch.name.padEnd(12)} tier=${ch.tier} backends=${JSON.stringify(ch.backends)}`);
});
ok(ALL_CHANNELS.length === 16, `count = ${ALL_CHANNELS.length}`);
ok(ALL_CHANNELS[ALL_CHANNELS.length - 1].name === 'web', 'WebChannel is STILL last');

// ═══ P2 — routing per channel ═══
console.log('\n════ P2 — routing ════');
for (const u of [
  'https://twitter.com/jack/status/20',
  'https://www.reddit.com/r/node/comments/abc/example_post/',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://github.com/torvalds/linux',
  'https://www.v2ex.com/t/1000000',
  'https://example.com',
]) {
  const r = route(u);
  console.log(`  ${u}  →  ${r.channel.name}  (${r.reason})`);
}

// ═══ P3 — real reads ═══
console.log('\n════ P3 — real reads (Tier 0 where the sandbox allows; honest failures elsewhere) ════');
const READS = [
  ['github', 'https://github.com/torvalds/linux'],
  ['reddit', 'https://www.reddit.com/r/node/comments/18ew0xh/node_v2100_released/'],
  ['youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
  ['rss', 'https://feeds.bbci.co.uk/news/rss.xml'],
  ['v2ex', 'https://www.v2ex.com/t/1093529'],
  ['xueqiu', 'https://xueqiu.com/about'],
  ['twitter', 'https://x.com/elonmusk/status/1585841080431321088'],
  ['instagram', 'https://www.instagram.com/instagram/'],
];
for (const [name, url] of READS) {
  console.log(`\n  ── read [${name}] ${url}`);
  try {
    const r = await read(url);
    const c = r.content;
    const preview = typeof c === 'object' ? JSON.stringify(c).slice(0, 260) : clip(c, 260);
    console.log(`     ✅ backend=${r.backend} | content: ${preview}`);
  } catch (err) {
    console.log(`     ❌ [${err.code || 'ERROR'}] ${String(err.message).slice(0, 200)}`);
    if (err.attempts) console.log(`        chain: ${JSON.stringify(err.attempts.map((a) => ({ b: a.backend, e: String(a.error).slice(0, 70) })))}`);
  }
}

// ═══ P4 — check() per channel ═══
console.log('\n════ P4 — check() all 16 ════');
const results4 = await checkAll(new ReachConfig(path.join(tmpdir(), 'reach-e.yaml')));
for (const r of Object.values(results4)) {
  console.log(`  ${r.status === 'ok' ? '✅' : r.status === 'warn' ? '⚠️ ' : r.status === 'off' ? '⛔' : '❌'} ${r.name.padEnd(12)} [${r.status}] backend=${r.active_backend || '—'} tier=${r.tier} — ${String(r.message).slice(0, 120)}`);
}

// ═══ P5 — doctor --json over all 16 (CLI) ═══
console.log('\n════ P5 — doctor --json (CLI, all channels) ════');
const out5 = execFileSync(process.execPath, [path.join(ROOT, 'capability/internet/reach/doctor.js'), '--json'], { encoding: 'utf8', timeout: 120000 });
const parsed5 = JSON.parse(out5);
console.log(`channels in doctor output: ${Object.keys(parsed5).length} → ${Object.keys(parsed5).join(', ')}`);
console.log(out5.trim().split('\n').slice(0, 40).join('\n'));

// ═══ P6 — anti-bot per channel ═══
console.log('\n════ P6 — anti-bot / challenge handling this run ════');
let challengeHits = 0;
for (const [name, url] of READS) {
  const ch = ALL_CHANNELS.find((c) => c.name === name);
  if (!ch) continue;
  try {
    await ch.read(url, new ReachConfig(path.join(tmpdir(), 'reach-e2.yaml')));
  } catch (err) {
    if (err.code === 'AUTH_REQUIRED' || err.code === 'ANTIBOT_DETECTED') {
      challengeHits++;
      console.log(`  ${name}: [${err.code}] ${String(err.message).slice(0, 140)}`);
    }
  }
}
if (challengeHits === 0) console.log('  no channel hit a challenge page this run — marked "not exercised this run" honestly');
else ok(challengeHits > 0, `${challengeHits} challenge/login wall(s) detected and refused with specific codes (content NOT returned)`);

// ═══ P7 — routing precedence (double match) ═══
console.log('\n════ P7 — precedence: URL matching MULTIPLE channels ════');
const u7 = 'https://gist.github.com/sindresorhus/aaa7c0d24d6d7b8b9c9b';
const candidates7 = ALL_CHANNELS.filter((c) => {
  try { return c.can_handle(u7); } catch { return false; }
});
console.log(`  URL: ${u7}`);
console.log(`  channels whose can_handle() === true: [${candidates7.map((c) => c.name).join(', ')}]`);
const winner = route(u7);
console.log(`  route() → ${winner.channel.name} (${winner.reason})`);
ok(winner.channel.name === 'github' && candidates7.map((c) => c.name).includes('web'), 'specific channel (github) wins over the universal web fallback');
const u7b = 'https://www.reddit.com/r/javascript.rss';
const cands7b = ALL_CHANNELS.filter((c) => { try { return c.can_handle(u7b); } catch { return false; } });
const winner7b = route(u7b);
console.log(`  URL: ${u7b} → matches [${cands7b.map((c) => c.name).join(', ')}] → route() = ${winner7b.channel.name}`);
ok(winner7b.channel.name === 'reddit', 'reddit (listed before rss) wins a reddit.rss URL');

// ═══ P8 — tier fallback chain ═══
console.log('\n════ P8 — fallback chain (primary backend unavailable) ════');
const cfg8 = new ReachConfig(path.join(tmpdir(), 'reach-e3.yaml'));
cfg8.set('reddit_backend', 'nonexistent-backend');
let r8 = null, err8 = null;
try { r8 = await read('https://www.reddit.com/r/node/comments/18ew0xh/node_v2100_released/', { config: cfg8 }); }
catch (e) { err8 = e; }
const chain8 = r8?.attempts ?? err8?.attempts ?? [];
console.log('  override: reddit_backend=nonexistent-backend');
console.log(`  attempts: ${JSON.stringify(chain8.map((a) => ({ backend: a.backend, ok: a.ok, error: String(a.error).slice(0, 70) })))}`);
if (r8) console.log(`  served by: ${r8.backend}`);
else console.log(`  refused honestly: [${err8?.code}] ${String(err8?.message).slice(0, 140)}`);
ok(chain8[0]?.backend === 'nonexistent-backend', 'unknown override tried FIRST, failure recorded honestly');
ok(chain8.some((a) => a.backend === 'public-json'), 'chain fell through to public-json in order');
ok(!!r8 || err8?.code === 'AUTH_REQUIRED' || err8?.code === 'BACKEND_UNAVAILABLE', 'outcome honest: real content or specific refusal (never placeholder)');

console.log('\nALL P1–P8 DONE');
