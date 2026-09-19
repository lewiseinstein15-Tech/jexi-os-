#!/usr/bin/env node
/**
 * Phase 9 — Scope B — SSRF shield LIVE probe.
 *
 * P1  public URL allowed      → REAL DNS + REAL TLS + REAL HTTP (api.github.com)
 * P2  redirect to internal    → E_REDIRECT_TO_PRIVATE_IP (302 produced by a
 *     REAL local HTTP server; the first hop's DNS+socket is a LABELED test
 *     double because the sandbox has no public-IP host under our control —
 *     the shield's redirect machinery is the real code path)
 * P3  private IP refused      → E_PRIVATE_IP_REFUSED        (labeled resolver)
 * P4  loopback refused        → E_LOOPBACK_REFUSED          (labeled resolver)
 * P5  link-local refused      → E_LINK_LOCAL_REFUSED        (labeled resolver)
 * P6  cloud metadata refused  → E_METADATA_ENDPOINT_REFUSED (labeled resolver)
 * P7  DNS rebinding           → ONE resolution reused (no re-resolve, rebind
 *     has no effect) AND the belt-and-braces second check catches a rebind
 * P8  IPv6 private refused    → ::1, fc00::/7, fe80::/10 (+ mapped + IMDSv6)
 * P9  TLS pinning             → REAL certificate verified against the pinned
 *     hostname for the resolved IP; wrong pin refused; correct pin accepted
 * P10 broker integration      → pinnedFetch IS the trust pipeline's default
 *     transport: registered URL through the FULL chain (allowlist → shield →
 *     caps); private-IP refusal surfaces as a stable sanitized code
 *
 * Labeled test doubles are used ONLY where the sandbox cannot reproduce the
 * vector (no control over DNS, no public-IP HTTP host). Every double is
 * printed as such in the output. Exit 0 iff every assertion passes.
 */

import http from 'node:http';
import dns from 'node:dns';
import { Readable } from 'node:stream';

import {
  pinnedFetch,
  createPinnedFetchImpl,
  isPublicIP,
  classifyIp,
  ShieldRefusedError,
} from '../security/shield/ssrf.js';
import { resolveAndVerify } from '../security/shield/dns-guard.js';
import { createBroker } from '../intelligence/trust-pipeline/broker.js';
import { registerUrl } from '../intelligence/trust-pipeline/allowlist.js';

const UA = 'jexi-os-phase9-b-probe/1.0';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}${extra ? ` — ${extra}` : ''}`); }
  else { fail += 1; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
};

async function expectRefuse(name, p, wantCode) {
  try {
    const r = await p;
    ok(name, false, `NOT refused — status=${r && r.status}`);
    return r;
  } catch (err) {
    ok(name, err instanceof ShieldRefusedError && err.code === wantCode,
      `code=${err.code || '?'} detail="${err.detail || ''}"`);
    return err;
  }
}

/** Labeled static DNS double: hostname → A records. */
const staticResolver = (map) => ({
  calls: [],
  async resolve4(h) { this.calls.push(h); return map[h] || []; },
  async resolve6() { return []; },
});

const listen = (srv, port) => new Promise((resolve, reject) => {
  srv.once('error', reject);
  srv.listen(port, '127.0.0.1', () => { srv.off('error', reject); resolve(); });
});

// Shared across sections: the P1 success response (its URL is reused by P9).
let r1 = null;

/* ─────────────────── P0 — IP classification matrix ────────────────────── */
console.log('\n═══ P0 — isPublicIP / classifyIp policy matrix ═══');
{
  const publicIps = ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700::1111', '2001:4860:4860::8888'];
  for (const ip of publicIps) {
    ok(`P0 ${ip} is public`, isPublicIP(ip) === true, classifyIp(ip).detail);
  }
  const refused = [
    ['10.1.2.3', 'private'], ['172.16.0.1', 'private'], ['172.31.255.254', 'private'],
    ['192.168.1.1', 'private'], ['100.64.0.1', 'reserved'], ['0.0.0.0', 'reserved'],
    ['127.0.0.1', 'loopback'], ['127.8.8.8', 'loopback'],
    ['169.254.169.254', 'metadata'], ['169.254.170.2', 'metadata'], ['169.254.17.20', 'link-local'],
    ['192.0.2.1', 'reserved'], ['198.51.100.7', 'reserved'], ['203.0.113.9', 'reserved'],
    ['198.18.0.1', 'reserved'], ['224.0.0.1', 'multicast'], ['239.255.255.250', 'multicast'],
    ['240.0.0.1', 'reserved'], ['255.255.255.255', 'reserved'],
    ['::1', 'loopback'], ['::', 'reserved'], ['fc00::1', 'private'], ['fd12:3456::1', 'private'],
    ['fe80::1', 'link-local'], ['fe80::1%eth0', 'link-local'], ['ff02::1', 'multicast'],
    ['2001:db8::1', 'reserved'], ['64:ff9b::10.0.0.1', 'private'],
    ['::ffff:10.0.0.1', 'private'], ['::ffff:127.0.0.1', 'loopback'], ['fd00:ec2::254', 'metadata'],
  ];
  for (const [ip, want] of refused) {
    const c = classifyIp(ip);
    ok(`P0 ${ip} → ${want}`, c.public === false && c.type === want, c.detail);
  }
}

/* ───────────────────── P1 — public URL allowed (REAL) ─────────────────── */
console.log('\n═══ P1 — public URL allowed (REAL DNS + REAL TLS + REAL HTTP) ═══');
{
  const rawA = await dns.promises.resolve4('api.github.com').catch(() => []);
  console.log(`      dns A(api.github.com) = ${rawA.join(', ') || '(none)'}`);
  ok('P1a real DNS resolved', rawA.length > 0, `${rawA.length} A records`);

  // Primary: api.github.com (the directive-named host). The sandbox egress
  // IP (47.57.242.119) is SHARED — GitHub's unauthenticated 60/hr quota
  // flaps; every attempt is pasted raw. Fallbacks: keyless public hosts.
  const attempts1 = [
    ['https://api.github.com/zen', 'api.github.com/zen'],
    ['https://timeapi.io/api/Time/current/zone?timeZone=UTC', 'timeapi.io'],
    ['https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=1', 'll.thespacedevs.com'],
  ];
  for (const [u, name] of attempts1) {
    const g = await pinnedFetch(u, { headers: { 'user-agent': UA } });
    const gt = await g.text();
    console.log(`      [${name} → status=${g.status} bytes=${Buffer.byteLength(gt)} head="${gt.slice(0, 90).replace(/\s+/g, ' ')}"]`);
    if (g.status === 200 && gt.trim()) { r1 = { ...g, text: gt }; break; }
    if (name === 'api.github.com/zen') {
      console.log('      [EXTERNAL: GitHub unauthenticated quota exhausted for the shared egress IP — falling through to keyless public hosts]');
    }
  }
  ok('P1b fetch succeeded', !!r1 && r1.status === 200, r1 ? `via=${r1.meta.url} bytes=${Buffer.byteLength(r1.text)}` : 'all attempts failed');
  ok('P1c every resolved IP verified public',
    !!r1 && r1.meta.resolved.length > 0 && r1.meta.classified.every((c) => c.public === true),
    r1 ? `resolved=[${r1.meta.resolved.join(', ')}] connected=${r1.meta.verifiedIp} (v${r1.meta.family})` : 'no response');
  ok('P1d TLS verified against original hostname',
    !!r1 && r1.meta.tls && r1.meta.tls.checks.hostnameMatch === true,
    r1 ? `subject=${r1.meta.tls.subject} issuer=${r1.meta.tls.issuer}` : 'no response');
  if (r1) {
    console.log(`      body: ${r1.text.replace(/\s+/g, ' ').slice(0, 90)}`);
    console.log(`      cert: CN=${r1.meta.tls.subject} san=${String(r1.meta.tls.san).slice(0, 80)}... validTo=${r1.meta.tls.validTo} fp256=${r1.meta.tls.fingerprint256}`);
  }
}

/* ─────────────── P2 — redirect to internal refused ────────────────────── */
console.log('\n═══ P2 — redirect to internal refused ═══');
let redirectPort = 0, internalPort = 0;
{
  // REAL local servers: internal target + a 302-er pointing at it.
  const internal = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('INTERNAL PAGE — must never be reached through the shield');
  });
  let port = 8080;
  try { await listen(internal, 8080); } catch { await listen(internal, 0); port = internal.address().port; }
  internalPort = port;
  const redirector = http.createServer((_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${internalPort}/` });
    res.end('redirecting');
  });
  await listen(redirector, 0);
  redirectPort = redirector.address().port;

  // P2a: the 302 is REAL — a manual-redirect fetch (no shield) shows it raw,
  // and a default fetch AUTO-FOLLOWS it into the internal page: the exact
  // hazard the shield exists to kill.
  const plain = await fetch(`http://127.0.0.1:${redirectPort}/`, { redirect: 'manual' });
  ok('P2a upstream really 302s to internal (raw, no shield)',
    plain.status === 302 && String(plain.headers.get('location') || '').includes('127.0.0.1'),
    `status=${plain.status} location=${plain.headers.get('location')}`);
  try { await plain.body.cancel(); } catch { /* noop */ }
  const autoFollow = await fetch(`http://127.0.0.1:${redirectPort}/`); // default: follow
  const followedBody = await autoFollow.text();
  ok('P2a-hazard an unshielded default fetch lands on the internal page',
    autoFollow.status === 200 && followedBody.includes('INTERNAL PAGE'),
    `auto-followed to status=${autoFollow.status} body="${followedBody.slice(0, 40)}"`);

  // P2b: the shield refuses the loopback URL OUTRIGHT (no connection made).
  await expectRefuse('P2b pinnedFetch refuses the loopback URL outright',
    pinnedFetch(`http://127.0.0.1:${redirectPort}/`), 'E_LOOPBACK_REFUSED');

  // P2c: labeled first-hop double (DNS+socket) → the REAL 302 from the REAL
  // server flows through the shield's REAL redirect machinery → refused.
  console.log(`      [labeled double: shield resolves hop-one.test → 93.184.216.34 (public); socket re-targeted to the local 302 server — sandbox has no public-IP host under our control. The 302 below is real HTTP.]`);
  const p2resolver = staticResolver({ 'hop-one.test': ['93.184.216.34'] });
  const p2transport = async () => new Promise((resolve, reject) => {
    const rq = http.get({ host: '127.0.0.1', port: redirectPort, path: '/' }, (rs) => {
      resolve({ status: rs.statusCode, headers: rs.headers, body: rs, cert: null });
    });
    rq.on('error', reject);
  });
  await expectRefuse('P2c redirect to internal refused (E_REDIRECT_TO_PRIVATE_IP)',
    pinnedFetch('http://hop-one.test/', {
      resolver: p2resolver, transport: p2transport, maxRedirects: 1,
      label: 'P2 labeled double: first-hop DNS+socket',
    }), 'E_REDIRECT_TO_PRIVATE_IP');
}

/* ──────── P3–P6 — private / loopback / link-local / metadata refused ──── */
console.log('\n═══ P3–P6 — non-public resolutions refused (labeled resolvers) ═══');
{
  const cases = [
    ['P3', 'private.test', ['10.0.0.1'], 'E_PRIVATE_IP_REFUSED'],
    ['P4', 'loopback.test', ['127.0.0.1'], 'E_LOOPBACK_REFUSED'],
    ['P5', 'linklocal.test', ['169.254.17.20'], 'E_LINK_LOCAL_REFUSED'],
    ['P6', 'metadata.test', ['169.254.169.254'], 'E_METADATA_ENDPOINT_REFUSED'],
  ];
  for (const [tag, host, ips, want] of cases) {
    let dialed = false;
    const spy = async () => {
      dialed = true;
      return { status: 200, headers: {}, body: Readable.from([]), cert: null };
    };
    const err = await expectRefuse(`${tag} ${ips[0]} refused (${want})`,
      pinnedFetch(`http://${host}/`, { resolver: staticResolver({ [host]: ips }), transport: spy }), want);
    ok(`${tag} refused pre-connect (socket never dialed)`, dialed === false,
      err instanceof ShieldRefusedError ? 'refusal raised by the DNS guard' : 'unexpected');
  }
}

/* ─────────────────────── P7 — DNS rebinding ───────────────────────────── */
console.log('\n═══ P7 — DNS rebinding: single resolution + second check ═══');
{
  // (a) pinnedFetch reuses ONE resolution — the flip-flop answer never runs.
  const flip = {
    rounds: 0, answers: [],
    async resolve4() {
      this.rounds += 1;
      const ans = this.rounds === 1 ? ['93.184.216.34'] : ['10.0.0.1']; // rebind on 2nd
      this.answers.push([...ans]);
      return ans;
    },
    async resolve6() { return []; },
  };
  const seenBySocket = [];
  const echoTransport = async (req) => {
    seenBySocket.push(`${req.hostname}→${req.ip}`);
    console.log(`      [labeled transport double: dials ${req.ip} exactly as the shield pinned; returns 200]`);
    return {
      status: 200, headers: { 'content-type': 'application/json' },
      body: Readable.from([Buffer.from('{"ok":true}')]), cert: null,
    };
  };
  const r7 = await pinnedFetch('http://rebind.test/', {
    resolver: flip, transport: echoTransport,
    label: 'P7 labeled double: flip-flop DNS + socket echo',
  });
  const body7 = await r7.text();
  ok('P7a fetch succeeded', r7.status === 200 && body7 === '{"ok":true}', `status=${r7.status} body=${body7}`);
  ok('P7a exactly ONE resolution round — rebind answer never consulted',
    flip.rounds === 1, `rounds=${flip.rounds} answers=${JSON.stringify(flip.answers)}`);
  ok('P7a socket connected to the verified public IP',
    seenBySocket.join('|') === 'rebind.test→93.184.216.34', `socket saw: ${seenBySocket.join(' | ')}`);

  // (b) belt-and-braces: a caller that DOES re-resolve gets caught by the
  // second check — divergence from the verified set ⇒ E_DNS_REBINDING_REFUSED.
  const flip2 = {
    rounds: 0,
    async resolve4() { this.rounds += 1; return this.rounds === 1 ? ['93.184.216.34'] : ['10.0.0.1']; },
    async resolve6() { return []; },
  };
  const first = await resolveAndVerify('rebind.test', { resolver: flip2 });
  ok('P7b round 1 verified public', first.addresses.length === 1 && first.addresses[0].ip === '93.184.216.34',
    `addresses=${first.addresses.map((a) => a.ip).join(', ')}`);
  try {
    await resolveAndVerify('rebind.test', { resolver: flip2, prior: first });
    ok('P7b second-check catches the rebinding', false, 'resolution was NOT refused');
  } catch (err) {
    ok('P7b second-check catches the rebinding',
      err instanceof ShieldRefusedError && err.code === 'E_DNS_REBINDING_REFUSED',
      `code=${err.code} detail="${err.detail}"`);
  }
}

/* ───────────────────── P8 — IPv6 private refused ──────────────────────── */
console.log('\n═══ P8 — IPv6 private-space refused (labeled resolvers) ═══');
{
  const cases = [
    ['P8a ::1 (loopback)', ['::1'], 'E_LOOPBACK_REFUSED'],
    ['P8b fc00::1 (unique local)', ['fc00::1'], 'E_PRIVATE_IP_REFUSED'],
    ['P8c fe80::1 (link-local)', ['fe80::1'], 'E_LINK_LOCAL_REFUSED'],
    ['P8d fd00:ec2::254 (AWS IMDS v6)', ['fd00:ec2::254'], 'E_METADATA_ENDPOINT_REFUSED'],
    ['P8e ::ffff:10.0.0.1 (IPv4-mapped)', ['::ffff:10.0.0.1'], 'E_PRIVATE_IP_REFUSED'],
  ];
  let n = 0;
  for (const [name, ips, want] of cases) {
    n += 1;
    const host = `v6-${n}.test`;
    await expectRefuse(`${name} refused (${want})`,
      pinnedFetch(`http://${host}/`, { resolver: staticResolver({ [host]: ips }) }), want);
  }
}

/* ─────────────── P9 — TLS pinning (REAL certificate) ──────────────────── */
console.log('\n═══ P9 — TLS pinning: cert verified for the resolved IP ═══');
{
  // Pin triple against ONE consistent, stable host (the shared egress IP's
  // GitHub quota flaps mid-run — observed live — so github is NOT used here;
  // timeapi.io is keyless, stable, and serves a real Sectigo certificate).
  const p9Candidates = [
    'https://timeapi.io/api/Time/current/zone?timeZone=UTC',
    'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=1',
  ];
  let p9Url = p9Candidates[0];
  {
    const probeR = await pinnedFetch(p9Url, { headers: { 'user-agent': UA } });
    await probeR.text();
    if (probeR.status !== 200) p9Url = p9Candidates[1];
  }
  const r9 = await pinnedFetch(p9Url, { headers: { 'user-agent': UA } });
  const tls = r9.meta.tls;
  const body9 = await r9.text(); // consume body (release socket)
  ok('P9a real fetch through pinned socket', r9.status === 200 && body9.length > 0,
    `via=${r9.meta.hostname} status=${r9.status} bytes=${Buffer.byteLength(body9)} ip=${r9.meta.verifiedIp}`);
  ok('P9b cert verified against pinned hostname for the resolved IP',
    tls && tls.ok && tls.checks.validity === true && tls.checks.hostnameMatch === true,
    `host=${tls && tls.hostname} ip=${r9.meta.verifiedIp}`);
  console.log(`      resolved=[${r9.meta.resolved.join(', ')}] connected=${r9.meta.verifiedIp} (v${r9.meta.family})`);
  console.log(`      cert: CN=${tls.subject} issuer=${tls.issuer}`);
  console.log(`            san=${String(tls.san).slice(0, 100)}`);
  console.log(`            valid: ${tls.validFrom} → ${tls.validTo}`);
  console.log(`            fp256=${tls.fingerprint256}`);
  console.log(`            checks=${JSON.stringify(tls.checks)}`);

  // Wrong pin → refused (real cert vs a bogus pinned fingerprint).
  const pinHost = r9.meta.hostname;
  await expectRefuse('P9c wrong pinned fingerprint refused',
    pinnedFetch(p9Url, {
      headers: { 'user-agent': UA },
      pins: { [pinHost]: ['00'.repeat(32)] },
    }), 'E_TLS_PIN_MISMATCH');

  // Correct pin (the REAL fingerprint just captured) → accepted. Pin
  // verification runs at the TLS layer — before any HTTP status matters.
  const fp = tls.fingerprint256;
  const r9d = await pinnedFetch(p9Url, {
    headers: { 'user-agent': UA },
    pins: { [pinHost]: [fp] },
  });
  const zen9d = await r9d.text();
  ok('P9d correct pinned fingerprint accepted',
    r9d.meta.tls && r9d.meta.tls.checks.pin === true && r9d.status >= 200 && r9d.status < 400,
    `via=${pinHost} status=${r9d.status} bytes=${Buffer.byteLength(zen9d)} pin=${fp}`);
  try { await r9d.body.cancel(); } catch { /* noop */ }
}

/* ─────────── P10 — integration with Scope A's trust pipeline ──────────── */
console.log('\n═══ P10 — pinnedFetch wired into trust-pipeline/broker.js ═══');
{
  // (a) REAL registered URL through the FULL chain: allowlist → shield
  // (DNS verify + pinned connect + TLS) → capped body → status gate.
  // NOTE: the USGS and LL2 edges flap between clean 200s, HTML challenge
  // pages, and transient 3xxs for this shared egress IP — every attempt is
  // pasted raw; the first registered endpoint returning JSON carries the
  // data assertion. The shield's transport integrity is unaffected either
  // way (redirects are refused BY DESIGN at the broker layer).
  const broker = createBroker();
  const candidates10 = [
    ['usgs', 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'],
    ['ll2', 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=1'],
    ['radio', 'https://all.api.radio-browser.info/json/servers'],
  ];
  let r10 = null;
  const log10 = [];
  for (const [tag, u] of candidates10) {
    for (let a = 1; a <= 2 && !r10; a++) {
      const r = await broker.fetch(u);
      const shape = r.ok
        ? (/^\s*[{[]/.test(r.text) ? 'json' : `non-json head="${r.text.replace(/\s+/g, ' ').slice(0, 45)}..."`)
        : `refused:${r.error ? r.error.code : '?'}`;
      log10.push(`${tag}#${a} status=${r.status} bytes=${r.bytes} ${shape}`);
      if (r.ok && /^\s*[{[]/.test(r.text)) r10 = r;
    }
    if (r10) break;
  }
  for (const l of log10) console.log(`      [${l}]`);
  ok('P10a registered URL through the FULL chain', !!r10 && r10.ok === true,
    r10 ? `status=${r10.status} bytes=${r10.bytes} via=${r10.url}` : 'no registered candidate returned JSON');
  ok('P10a registration attached',
    !!r10 && !!r10.registration && ['usgs-summary', 'launch-library-2', 'radio-browser-servers'].includes(r10.registration.id),
    r10 && r10.registration ? `id=${r10.registration.id} layer=${r10.registration.layer}` : 'none');
  ok('P10a shield ran underneath: IP public + TLS verified',
    !!r10 && !!r10.meta && isPublicIP(r10.meta.verifiedIp) && !!r10.meta.tls && r10.meta.tls.checks.hostnameMatch === true,
    r10 && r10.meta ? `resolved=[${r10.meta.resolved.slice(0, 4).join(', ')}${r10.meta.resolved.length > 4 ? ', …' : ''}] connected=${r10.meta.verifiedIp}` : 'no meta');
  let dataCount = -1;
  try {
    const j = r10.json();
    dataCount = Array.isArray(j)
      ? j.length
      : (j.features ? j.features.length : (j.count ?? (j.ac ? j.ac.length : -1)));
  } catch { /* keep -1 */ }
  ok('P10a data intact after full chain', dataCount > 0,
    `records=${dataCount} (registered source: ${r10 && r10.registration ? r10.registration.id : '-'})`);
  if (r10 && r10.meta && r10.meta.tls) {
    console.log(`      cert CN=${r10.meta.tls.subject} fp256=${r10.meta.tls.fingerprint256}`);
  }

  // (b) negative: a runtime-registered host that resolves PRIVATE → the
  // shield refusal surfaces through the broker as a stable sanitized code.
  registerUrl({
    id: 'scope-b-probe-internal', host: 'shield-refusal.internal',
    pathPrefixes: ['/x'], layer: 'probe', provider: 'probe',
    keyless: true, provenance: 'observed',
  });
  const broker2 = createBroker({
    fetchImpl: createPinnedFetchImpl({
      resolver: staticResolver({ 'shield-refusal.internal': ['10.99.0.1'] }),
      label: 'P10b labeled double: DNS only (10.99.0.1)',
    }),
  });
  const r10b = await broker2.fetch('https://shield-refusal.internal/x/data');
  ok('P10b private-IP refusal through the FULL chain',
    r10b.ok === false && r10b.error && r10b.error.code === 'E_PRIVATE_IP_REFUSED',
    `code=${r10b.error && r10b.error.code} msg="${r10b.error && r10b.error.message}"`);
  ok('P10b message templated (no internals leaked)',
    r10b.error && /^(request blocked|request failed): /.test(r10b.error.message),
    'sanitized surface');
  ok('P10b refusal recorded in broker audit',
    broker2.status().audit.some((a) => a.code === 'E_PRIVATE_IP_REFUSED'),
    `audit entries=${broker2.status().auditEntries}`);
}

/* ─────────────────────────────── cleanup ──────────────────────────────── */
// Local test servers are block-scoped to P2; process.exit below reclaims
// every open handle in one shot.

console.log(`\n═══════════════════════════════════════════════`);
console.log(`PROBE SUMMARY: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
