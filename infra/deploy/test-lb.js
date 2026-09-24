/**
 * Local test harness for the load balancer (deploy/lb-worker.js).
 *
 * Simulates two backend "brain" servers with plain Node http servers and runs
 * the Worker's `route()` function against them — no Cloudflare account needed.
 *
 * Run:  node deploy/test-lb.js
 */
import http from 'node:http';
import { route, probe } from './lb-worker.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A tiny fake origin that we can make sick on demand. */
function makeOrigin(name) {
  const server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (origin.failAll) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'simulated outage' }));
      return;
    }
    if (path === '/api/health') {
      res.writeHead(origin.health, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, instanceId: name, redis: false }));
      return;
    }
    if (path === '/stream') {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write('{"type":"log","agent":"Test","message":"chunk one"}\n');
      setTimeout(() => {
        res.write('{"type":"done","success":true}\n');
        res.end();
      }, 60);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ server: name, path }));
  });
  const origin = { name, url: '', health: 200, failAll: false, server };
  server.listen(0, '127.0.0.1', () => {
    origin.url = `http://127.0.0.1:${server.address().port}`;
  });
  return origin;
}

let passed = 0;
let failed = 0;
function check(label, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${label}${extra ? ` — ${extra}` : ''}`); }
  else { failed++; console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// Brute-force an IP that hashes to a chosen origin index (deterministic stickiness).
function ipForIndex(list, index) {
  const h = (s) => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; };
  for (let i = 0; ; i++) {
    const ip = `10.0.0.${i}`;
    if (h(ip) % list.length === index) return ip;
  }
}

const origins = [makeOrigin('A'), makeOrigin('B')];
await sleep(150); // wait for listen()

console.log('=== Load balancer tests ===');

// 1) Both healthy → every request answers 200 with a real origin
console.log('\n1) Both healthy');
{
  const req = new Request('http://lb.local/api/health', { headers: { 'CF-Connecting-IP': '9.9.9.9' } });
  const res = await route(req, origins);
  const body = await res.json();
  check('returns 200', res.status === 200);
  check('answered by a real origin', ['A', 'B'].includes(body.instanceId), `instance=${body.instanceId}`);
}

// 2) Stickiness → same visitor always hits the same origin
console.log('\n2) IP stickiness');
{
  const ip = ipForIndex(origins, 1); // pins to B
  const seen = new Set();
  for (let i = 0; i < 4; i++) {
    const req = new Request('http://lb.local/api/health', { headers: { 'CF-Connecting-IP': ip } });
    const res = await route(req, origins);
    const body = await res.json();
    seen.add(body.instanceId);
    await sleep(30);
  }
  check('same IP → same origin for all requests', seen.size === 1, [...seen].join(','));
}

// 3) Health probe → a sick origin is taken out of rotation
console.log('\n3) Active health check');
{
  origins[0].health = 503; // A becomes unhealthy
  const ok = await probe(origins[0]);
  check('probe reports A unhealthy', ok === false);
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    const req = new Request('http://lb.local/api/health', { headers: { 'CF-Connecting-IP': '9.9.9.9' } });
    const res = await route(req, origins);
    seen.add((await res.json()).instanceId);
  }
  check('all traffic now served by B only', seen.has('B') && !seen.has('A'), [...seen].join(','));
  origins[0].health = 200; // heal A
  await probe(origins[0]); // and confirm the probe sees her healthy again
  check('A back in rotation after healing', (await probe(origins[0])) === true);
}

// 4) Passive failover → an origin that 500s mid-request is retried on the other
console.log('\n4) Passive failover on 5xx');
{
  const ip = ipForIndex(origins, 1); // pins to B
  origins[1].failAll = true; // B starts 500ing everything
  const req = new Request('http://lb.local/api/health', { headers: { 'CF-Connecting-IP': ip } });
  const res = await route(req, origins);
  const body = await res.json();
  check('request failed over to A', res.status === 200 && body.instanceId === 'A', `from=${body.instanceId}`);
  origins[1].failAll = false;
}

// 5) Streaming pass-through (chat NDJSON) is not buffered/broken
console.log('\n5) Streaming pass-through');
{
  const req = new Request('http://lb.local/stream', { headers: { 'CF-Connecting-IP': '9.9.9.9' } });
  const res = await route(req, origins);
  const text = await res.text();
  check('content-type preserved', res.headers.get('content-type') === 'application/x-ndjson');
  check('both streamed lines arrive', text.includes('chunk one') && text.includes('"done"'), `${text.length} bytes`);
}

// 6) LB status endpoint
console.log('\n6) /__lb/status');
{
  const req = new Request('http://lb.local/__lb/status', { headers: { 'CF-Connecting-IP': '9.9.9.9' } });
  const res = await route(req, origins);
  const body = await res.json();
  check('lists both origins', body.origins?.length === 2);
  check('healthy flags present', body.origins.every((o) => typeof o.healthy === 'boolean'));
}

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
origins.forEach((o) => o.server.close());
process.exit(failed ? 1 : 0);
