/**
 * JEXI OS — Cloudflare Worker Load Balancer (horizontal scaling layer)
 * --------------------------------------------------------------------
 * Runs on Cloudflare's FREE tier (100,000 requests/day, no credit card).
 *
 * What it does, matching the horizontal-scaling video:
 *   - Keeps a list of backend "brain" servers (origins)
 *   - Health-checks them: an active probe hits each origin's /api/health every
 *     PROBE_SECONDS, and any 5xx/timeout on a real request marks it down too
 *     (passive failover) — down origins are kept out of rotation for COOLDOWN_MS
 *   - Routes each request to a healthy origin, preferring the one this visitor
 *     used before (IP-based stickiness), so the virtual desktop and long
 *     conversations stay on the same instance
 *   - Passes chat streaming (NDJSON), bodies and CORS through untouched
 *   - GET /__lb/status shows the live health of every origin
 *
 * Deploy (free, ~5 min): see SCALING.md
 */

// ==== CONFIGURATION ======================================================
// Origin #1 is your current free Render server. When you ever add a second
// free/paid backend host, just add it to this list — the balancer picks it up
// automatically. Both instances share JEXI's memory via Upstash Redis
// (REDIS_URL), so they behave like one brain.
const ORIGINS = [
  { name: 'render-primary', url: 'https://jexi-os-brain.onrender.com' },
  // { name: 'host-two', url: 'https://your-second-backend.example.com' },
];

const PROBE_SECONDS = 25;       // active health-check freshness window
const COOLDOWN_MS = 60_000;     // how long a failed origin stays out of rotation
const PROBE_TIMEOUT_MS = 5_000; // health probe timeout
const REQUEST_TIMEOUT_MS = 28_000; // max wall time (Workers free caps an invocation at ~30s)

// NOTE: Cloudflare's free plan caps each invocation at ~30s wall-clock, so very
// long chat answers (deep research can take 20-60s) cannot stream through the
// balancer on the free tier. Point the app at an origin directly for those, or
// run the worker on a paid plan (5-minute limit) once a second server exists.

// ==== HEALTH STATE (per-isolate bookkeeping) ==============================
const state = {};

function originState(name) {
  return (state[name] ??= { healthy: true, lastCheck: 0, lastFail: 0, fails: 0, latency: 0 });
}

/** Active probe: hit /api/health and record the result. */
export async function probe(origin) {
  const s = originState(origin.name);
  const now = Date.now();
  try {
    const t0 = now;
    const res = await fetch(`${origin.url}/api/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const body = await res.json().catch(() => null);
    s.healthy = res.status < 500 && res.status !== 429 && body?.ok !== false;
    s.lastCheck = Date.now();
    if (!s.healthy) { s.fails++; s.lastFail = Date.now(); } else { s.fails = 0; s.latency = Date.now() - t0; }
  } catch (e) {
    s.healthy = false;
    s.fails++;
    s.lastFail = Date.now();
    s.lastCheck = Date.now();
  }
  return s.healthy;
}

const fresh = (s, now) => now - s.lastCheck < PROBE_SECONDS * 1000;
const cooling = (s, now) => now - s.lastFail < COOLDOWN_MS;

/** An origin is usable if it never failed, or its cooldown has expired. */
function usable(origin, now) {
  const s = originState(origin.name);
  if (s.fails === 0) return true;
  if (cooling(s, now)) return false;
  return fresh(s, now) ? s.healthy : true; // cooldown over → give it another chance
}

function hashIp(ip) {
  let h = 0;
  for (const c of String(ip || 'unknown')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

// ==== ROUTING ============================================================
export async function route(request, origins = ORIGINS) {
  const url = new URL(request.url);
  const now = Date.now();

  // Live status page — handy to confirm the balancer sees your servers.
  if (url.pathname === '/__lb/status') {
    return Response.json({
      service: 'JEXI OS load balancer',
      time: new Date().toISOString(),
      origins: origins.map((o) => ({ name: o.name, url: o.url, ...originState(o.name) })),
    }, { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  // Fire a health probe for any origin whose check is stale (one per request).
  const stale = origins.find((o) => !fresh(originState(o.name), now));
  if (stale) probe(stale); // fire-and-forget

  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-real-ip') || 'unknown';
  const preferred = origins[hashIp(ip) % origins.length];
  const healthy = origins.filter((o) => usable(o, now));
  const target = healthy.includes(preferred) ? preferred : healthy[0] || preferred;

  // Forward everything (headers minus host, plus the body for non-GET).
  const headers = new Headers(request.headers);
  headers.delete('host');
  const init = { method: request.method, headers, redirect: 'follow' };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.arrayBuffer();

  const forward = async (origin, signal) =>
    fetch(origin.url + url.pathname + url.search, { ...init, signal });

  const fail = (origin) => {
    const s = originState(origin.name);
    s.healthy = false;
    s.fails++;
    s.lastFail = Date.now();
  };

  try {
    const res = await forward(target, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
    if (res.status >= 500 || res.status === 429) {
      // Passive failover: origin errored — retry once on another healthy one.
      fail(target);
      const alt = healthy.filter((o) => o.name !== target.name)[0];
      if (alt) {
        const retry = await forward(alt, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
        return new Response(retry.body, { status: retry.status, headers: retry.headers });
      }
    }
    return new Response(res.body, { status: res.status, headers: res.headers });
  } catch (e) {
    fail(target);
    const alt = healthy.filter((o) => o.name !== target.name)[0];
    if (alt) {
      try {
        const retry = await forward(alt, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
        return new Response(retry.body, { status: retry.status, headers: retry.headers });
      } catch (e2) { /* both down — fall through */ }
    }
    return Response.json(
      { success: false, error: 'JEXI\'s brain did not answer in time (the free Worker caps requests at ~30s — long answers should go straight to the server, or the balancer needs a paid plan). Try again, or set the app\'s Server URL back to the direct address.' },
      { status: 503, headers: { 'content-type': 'application/json' } }
    );
  }
}

export default {
  fetch(request) {
    return route(request);
  },
  // Optional: probe all origins on a cron trigger for always-fresh health.
  scheduled() {
    return Promise.all(ORIGINS.map(probe));
  },
};
