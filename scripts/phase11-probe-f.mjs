// Phase 11 Scope F — ORDERED BACKEND ROUTING: formal probe of
// Channel.ordered_backends + Channel.readViaBackends + ReachConfig layering.
// Real HTTP wherever the network allows; the ONLY synthetic part is the P8
// fixture channel (labeled FIXTURE) whose three backends all fail — it
// exercises the real driver with deterministic failures, no platform data.
//
//   P1  default chain (first-success-wins)          [real HTTP]
//   P2  config override moves backend to front      [real HTTP]
//   P3  env override moves backend to front         [real HTTP]
//   P4  env beats config                            [real HTTP]
//   P5  unknown override → honest first attempt     [real HTTP]
//   P6  fallback on primary fail                    [real HTTP]
//   P7  AUTH_REQUIRED is chain-fatal                [real HTTP]
//   P8  all backends fail → terminal .attempts      [FIXTURE]
//   P9  config sourceOf provenance                  [no net]
//   P10 determinism (same input → same backend)     [real HTTP ×2]
//   P11 cross-channel independence                  [real HTTP]

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { read } from '../capabilities/graph/internet/reach/core.js';
import { ReachConfig } from '../capabilities/graph/internet/reach/config.js';
import { getChannel } from '../capabilities/graph/internet/reach/channels/index.js';
import { Channel } from '../capabilities/graph/internet/reach/channels/base.channel.js';

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label}`); }
}
const attemptsDump = (r) => JSON.stringify((r?.attempts ?? []).map((a) => ({ backend: a.backend, ok: a.ok, error: String(a.error).slice(0, 80) })));

const TWEET = 'https://x.com/elonmusk/status/1585841080431321088';
const REPO = 'https://github.com/torvalds/linux';
const TOPIC = 'https://www.v2ex.com/t/1093529';

// ── P1 — default chain ──
console.log('\n════ P1 — default chain (no override; first success wins) ════');
{
  const ch = getChannel('twitter');
  const ob = ch.ordered_backends(new ReachConfig(join(tmpdir(), 'reach-f-p1.yaml')));
  console.log(`  declared backends: ${JSON.stringify(ch.backends)}`);
  console.log(`  ordered_backends (no override): ${JSON.stringify(ob)}`);
  const r = await read(TWEET);
  console.log(`  served by: ${r.backend} | routing.channel: ${r.routing.channel} | active_backend: ${ch.active_backend}`);
  console.log(`  attempts (failures before success): ${attemptsDump(r)}`);
  console.log(`  content: ${JSON.stringify(r.content).slice(0, 140)}`);
  ok(ch.backends[0] === 'syndication' && ob.list[0] === 'syndication' && ob.override === null, 'P1 no override → declared order preserved');
  ok(r.backend === 'syndication' && (r.attempts ?? []).length === 0, 'P1 first success wins (zero failed attempts logged)');
}

// ── P2 — config override moves backend to front ──
console.log('\n════ P2 — config override: github_backend="Jina Reader" (file) ════');
{
  const cfg = new ReachConfig(join(tmpdir(), 'reach-f-p2.yaml'));
  cfg.set('github_backend', 'Jina Reader');
  const ch = getChannel('github');
  const ob = ch.ordered_backends(cfg);
  console.log(`  sourceOf('github_backend'): ${cfg.sourceOf('github_backend')} | channelBackend(): ${cfg.channelBackend('github')}`);
  console.log(`  ordered_backends: ${JSON.stringify(ob)}`);
  const r = await read(REPO, { config: cfg });
  console.log(`  served by: ${r.backend}`);
  console.log(`  attempts: ${attemptsDump(r)}`);
  console.log(`  content (head): ${JSON.stringify(r.content).slice(0, 120)}`);
  ok(ob.applied === true && ob.override === 'Jina Reader' && ob.list[0] === 'Jina Reader', 'P2 override moved "Jina Reader" to front');
  ok(r.backend === 'Jina Reader' && (r.attempts ?? []).length === 0, 'P2 override backend served FIRST TRY (empty attempts = nothing else tried; real Jina render)');
}

// ── P3 — env override moves backend to front ──
console.log('\n════ P3 — env override: V2EX_BACKEND="Jina Reader" ════');
{
  process.env.V2EX_BACKEND = 'Jina Reader';
  try {
    const cfg = new ReachConfig(join(tmpdir(), 'reach-f-p3.yaml')); // empty file layer — env must win alone
    const ch = getChannel('v2ex');
    const ob = ch.ordered_backends(cfg);
    console.log(`  sourceOf('v2ex_backend'): ${cfg.sourceOf('v2ex_backend')} | channelBackend(): ${cfg.channelBackend('v2ex')}`);
    console.log(`  ordered_backends: ${JSON.stringify(ob)}`);
    const r = await read(TOPIC, { config: cfg });
    console.log(`  served by: ${r.backend}`);
    console.log(`  attempts: ${attemptsDump(r)}`);
    ok(cfg.sourceOf('v2ex_backend') === 'env', 'P3 source is env');
    ok(r.backend === 'Jina Reader' && (r.attempts ?? []).length === 0, 'P3 env override served FIRST TRY (empty attempts; real Jina render of v2ex)');
  } finally { delete process.env.V2EX_BACKEND; }
}

// ── P4 — env beats config ──
console.log('\n════ P4 — env beats config: v2ex_backend file="Jina Reader" + V2EX_BACKEND="public-api" ════');
{
  process.env.V2EX_BACKEND = 'public-api';
  try {
    const cfg = new ReachConfig(join(tmpdir(), 'reach-f-p4.yaml'));
    cfg.set('v2ex_backend', 'Jina Reader');
    const ch = getChannel('v2ex');
    const ob = ch.ordered_backends(cfg);
    console.log(`  file says: "Jina Reader" | env says: "public-api"`);
    console.log(`  sourceOf('v2ex_backend'): ${cfg.sourceOf('v2ex_backend')} | channelBackend(): ${cfg.channelBackend('v2ex')}`);
    console.log(`  ordered_backends: ${JSON.stringify(ob)}`);
    const r = await read(TOPIC, { config: cfg });
    console.log(`  served by: ${r.backend} | attempts: ${attemptsDump(r)}`);
    console.log(`  content (head): ${JSON.stringify(r.content).slice(0, 120)}`);
    ok(cfg.sourceOf('v2ex_backend') === 'env' && cfg.channelBackend('v2ex') === 'public-api', 'P4 layering env > file (sourceOf + effective value)');
    ok(r.backend === 'public-api' && ob.list[0] === 'public-api' && (r.attempts ?? []).length === 0, 'P4 env backend served FIRST TRY (config backend NOT tried)');
  } finally { delete process.env.V2EX_BACKEND; }
}

// ── P5 — unknown override ──
console.log('\n════ P5 — unknown override: reddit_backend="nonexistent-xyz" ════');
{
  const cfg = new ReachConfig(join(tmpdir(), 'reach-f-p5.yaml'));
  cfg.set('reddit_backend', 'nonexistent-xyz');
  const ch = getChannel('reddit');
  const ob = ch.ordered_backends(cfg);
  console.log(`  ordered_backends: ${JSON.stringify(ob)}`);
  let r = null, err = null;
  try { r = await read('https://www.reddit.com/r/node/comments/18ew0xh/node_v2100_released/', { config: cfg }); }
  catch (e) { err = e; }
  const chain = r?.attempts ?? err?.attempts ?? [];
  console.log(`  attempts: ${JSON.stringify(chain.map((a) => ({ backend: a.backend, ok: a.ok, error: String(a.error).slice(0, 70) })))}`);
  if (r) console.log(`  served by: ${r.backend}`);
  else console.log(`  terminal: [${err?.code}] ${String(err?.message).slice(0, 120)}`);
  ok(chain[0]?.backend === 'nonexistent-xyz' && chain[0]?.ok === false, 'P5 unknown override tried FIRST, honest failure recorded');
  ok(chain.some((a) => a.backend === 'public-json'), 'P5 chain fell through to the real backends in order');
  ok(!!r || err?.code === 'AUTH_REQUIRED' || err?.code === 'BACKEND_UNAVAILABLE', 'P5 terminal outcome honest (real content or specific refusal)');
}

// ── P6 — fallback on primary fail (REAL: bili-cli not installed in sandbox) ──
console.log('\n════ P6 — fallback on primary fail: bilibili (bili-cli missing → public-api → Jina) ════');
{
  const cfg = new ReachConfig(join(tmpdir(), 'reach-f-p6.yaml'));
  const ch = getChannel('bilibili');
  const r = await read('https://www.bilibili.com/video/BV1GJ411x7h7/', { config: cfg });
  console.log(`  declared: ${JSON.stringify(ch.backends)}`);
  console.log(`  attempts: ${attemptsDump(r)}`);
  console.log(`  served by: ${r.backend}`);
  console.log(`  content (head): ${JSON.stringify(r.content).slice(0, 140)}`);
  ok(r.attempts.length >= 1 && r.attempts[0].backend === 'bili-cli' && r.attempts[0].ok === false, 'P6 primary (bili-cli) failed honestly (RUNTIME_MISSING)');
  ok(r.backend !== 'bili-cli' && r.attempts.every((a, i) => i === 0 || a.ok === false), 'P6 next backend tried after primary failure; only failures logged');
  ok(r.ok === true, 'P6 first success won after fallback');
}

// ── P7 — AUTH_REQUIRED is chain-fatal ──
console.log('\n════ P7 — chain-fatal: TWITTER_BACKEND="Jina Reader" (wall on first) ════');
{
  process.env.TWITTER_BACKEND = 'Jina Reader';
  try {
    const cfg = new ReachConfig(join(tmpdir(), 'reach-f-p7.yaml'));
    const ch = getChannel('twitter');
    console.log(`  ordered_backends: ${JSON.stringify(ch.ordered_backends(cfg))}`);
    let r = null, err = null;
    try { r = await read(TWEET, { config: cfg }); } catch (e) { err = e; }
    const chain = r?.attempts ?? err?.attempts ?? [];
    console.log(`  attempts: ${JSON.stringify(chain.map((a) => ({ backend: a.backend, ok: a.ok, error: String(a.error).slice(0, 90) })))}`);
    if (r) console.log(`  served by: ${r.backend}`);
    else console.log(`  terminal: [${err?.code}] ${String(err?.message).slice(0, 120)}`);
    ok(!r && err?.code === 'AUTH_REQUIRED', 'P7 terminal error is AUTH_REQUIRED');
    ok(chain.length === 1 && chain[0].backend === 'Jina Reader', 'P7 chain STOPPED at the wall — syndication (backend[2]) NOT attempted');
  } finally { delete process.env.TWITTER_BACKEND; }
}

// ── P8 — all backends fail (FIXTURE channel; real driver) ──
console.log('\n════ P8 — all backends fail → terminal .attempts (FIXTURE) ════');
{
  class AllFailFixture extends Channel {
    name = 'allfail-fixture';
    description = 'FIXTURE: three synthetic backends, all fail — exercises the real chain driver';
    backends = ['primary-a', 'secondary-b', 'tertiary-c'];
    tier = 0;
    can_handle() { return false; }
    async read(url, cfg = {}) {
      return this.readViaBackends(cfg, {
        'primary-a': async () => { throw new Error('FETCH_FAILED: simulated primary outage'); },
        'secondary-b': async () => { const e = new Error('RUNTIME_MISSING: secondary not installed'); e.code = 'RUNTIME_MISSING'; throw e; },
        'tertiary-c': async () => { throw new Error('HTTP 503 from tertiary'); },
      });
    }
  }
  const fx = new AllFailFixture();
  let err = null, r = null;
  try { r = await fx.read('fixture://all-fail', new ReachConfig(join(tmpdir(), 'reach-f-p8.yaml'))); } catch (e) { err = e; }
  console.log(`  terminal: [${err?.code}] ${String(err?.message).slice(0, 200)}`);
  console.log(`  attempts: ${JSON.stringify(err?.attempts ?? r?.attempts ?? [])}`);
  ok(!r && err?.code === 'BACKEND_UNAVAILABLE', 'P8 terminal code BACKEND_UNAVAILABLE (nothing auth-ish → not AUTH_REQUIRED)');
  ok((err?.attempts ?? []).length === 3 && err.attempts.every((a) => a.ok === false), 'P8 full attempts array: every backend + every failure reason');
  ok(JSON.stringify(err.attempts.map((a) => a.backend)) === JSON.stringify(['primary-a', 'secondary-b', 'tertiary-c']), 'P8 attempts in declared order');
}

// ── P9 — config sourceOf provenance ──
console.log('\n════ P9 — sourceOf provenance: unset | file | env ════');
{
  const unset = new ReachConfig(join(tmpdir(), 'reach-f-p9a.yaml'));
  const file = new ReachConfig(join(tmpdir(), 'reach-f-p9b.yaml'));
  file.set('github_backend', 'Jina Reader');
  process.env.V2EX_BACKEND = 'public-api';
  const env = new ReachConfig(join(tmpdir(), 'reach-f-p9c.yaml'));
  try {
    console.log(`  unset  github_backend → sourceOf: ${unset.sourceOf('github_backend')}`);
    console.log(`  file   github_backend → sourceOf: ${file.sourceOf('github_backend')} (value: ${file.get('github_backend')})`);
    console.log(`  env    v2ex_backend    → sourceOf: ${env.sourceOf('v2ex_backend')} (value: ${env.get('v2ex_backend')})`);
    ok(unset.sourceOf('github_backend') === 'unset', 'P9 unset → "unset"');
    ok(file.sourceOf('github_backend') === 'file', 'P9 file override → "file"');
    ok(env.sourceOf('v2ex_backend') === 'env', 'P9 env override → "env"');
  } finally { delete process.env.V2EX_BACKEND; }
}

// ── P10 — determinism ──
console.log('\n════ P10 — determinism: same read twice, no override ════');
{
  const cfg = new ReachConfig(join(tmpdir(), 'reach-f-p10.yaml'));
  const r1 = await read(TWEET, { config: cfg });
  const r2 = await read(TWEET, { config: cfg });
  const shape = (x) => JSON.stringify({ backend: x.backend, attempts: x.attempts.length, contentKeys: Object.keys(x.content).sort(), routingChannel: x.routing.channel });
  console.log(`  run1: backend=${r1.backend} routing=${r1.routing.channel} shape=${shape(r1)}`);
  console.log(`  run2: backend=${r2.backend} routing=${r2.routing.channel} shape=${shape(r2)}`);
  ok(r1.backend === r2.backend && r1.routing.channel === r2.routing.channel, 'P10 same backend + same channel both runs');
  ok(shape(r1) === shape(r2), 'P10 identical result structure (backend, attempts length, content keys)');
}

// ── P11 — cross-channel independence ──
console.log('\n════ P11 — override ONE channel; others unaffected ════');
{
  const cfg = new ReachConfig(join(tmpdir(), 'reach-f-p11.yaml'));
  cfg.set('github_backend', 'Jina Reader'); // github overridden…
  const gh = getChannel('github'), vx = getChannel('v2ex'), yt = getChannel('youtube');
  console.log(`  github ordered:    ${JSON.stringify(gh.ordered_backends(cfg))}`);
  console.log(`  v2ex  ordered:     ${JSON.stringify(vx.ordered_backends(cfg))}`);
  console.log(`  youtube ordered:   ${JSON.stringify(yt.ordered_backends(cfg))}`);
  const rv = await read(TOPIC, { config: cfg });
  const ry = await read('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { config: cfg });
  console.log(`  v2ex served by: ${rv.backend} | youtube served by: ${ry.backend}`);
  ok(gh.ordered_backends(cfg).override === 'Jina Reader' && vx.ordered_backends(cfg).override === null && yt.ordered_backends(cfg).override === null, 'P11 override scoped to github only');
  ok(rv.backend === 'public-api' && ry.backend === 'oembed', 'P11 other channels served by their DEFAULT first backends');
}

console.log(`\n════ SCOPE F PROBE DONE — ${pass} passed, ${fail} failed ════`);
process.exit(fail === 0 ? 0 : 1);
