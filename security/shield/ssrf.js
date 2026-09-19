/**
 * JEXI OS — Phase 9 Scope B — SSRF shield for outbound fetches.
 *
 * Complements the trust pipeline's allowlist (Scope A) with IP-layer
 * defense. Every outbound fetch the shield performs:
 *
 *   1. resolves DNS ONCE (A + AAAA in a single round) via dns-guard
 *   2. refuses if ANY resolved address is non-public — RFC1918, loopback,
 *      link-local, multicast, unique-local, metadata endpoints
 *      (169.254.169.254 et al.), CGNAT, TEST-NET, reserved, mapped IPv6
 *   3. connects to the VERIFIED IP (custom lookup — no TOCTOU re-resolve;
 *      a socket attempt to resolve any other host is itself refused)
 *   4. keeps the ORIGINAL hostname for SNI + certificate validation and
 *      independently verifies the presented certificate against it
 *      (validity window, SAN coverage, optional fingerprint pins)
 *   5. redirects are refused by default (maxRedirects = 0, the 3xx
 *      surfaces to the caller); when following is explicitly enabled,
 *      EVERY hop is re-classified via checkRedirect (non-public target →
 *      E_REDIRECT_TO_PRIVATE_IP, https→http downgrade refused, loops
 *      refused) and re-resolved through the same shield
 *
 * `pinnedFetch` is the raw shield primitive. `createPinnedFetchImpl`
 * wraps it in a fetch()-compatible adapter so the trust pipeline's broker
 * (Scope A) uses the shield as its DEFAULT transport.
 *
 * Test seams (used ONLY by labeled probe doubles — never in production
 * paths): `resolver` swaps DNS; `transport` swaps the socket engine;
 * `label` tags the run so reports can say honestly which parts were
 * doubled.
 */

import http from 'node:http';
import https from 'node:https';

import {
  ShieldRefusedError,
  classifyIp,
  isPublicIP,
  resolveAndVerify,
} from './dns-guard.js';
import { verifyPinnedCert } from './tls-pin.js';

/** Public surface: shield error + IP policy predicate (directive API). */
export { ShieldRefusedError, ShieldRefusedError as SsrfRefusedError, classifyIp, isPublicIP };

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 0; // refuse: 3xx surfaces to the caller
const FOLLOW_MAX_REDIRECTS = 5;  // only when redirect:'follow' is explicit

/** Well-known cloud metadata HOSTNAMES (the IPs are covered by dns-guard). */
const METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
]);

const isIpLiteral = (host) =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');

function throwMalformed(detail) {
  throw new ShieldRefusedError('E_MALFORMED_URL', detail);
}

/* ─────────────────────────── redirect policy ──────────────────────────── */

const loopKey = (u) => `${u.origin}${u.pathname}${u.search}`;

/**
 * Decide whether the next redirect hop may be followed.
 * @param {Array<{url: string, status: number, location: string|null}>} chain
 *   The redirect chain so far; the LAST entry is the hop being decided.
 * @param {{ resolver?: object }} [opts]
 * @returns {Promise<{ allowed: true, target: URL, classification: object }>}
 * @throws ShieldRefusedError
 *   E_MALFORMED_URL            — missing/unparsable Location
 *   E_REDIRECT_BAD_SCHEME      — target scheme not http(s)
 *   E_REDIRECT_TO_PRIVATE_IP   — target is a non-public host/IP (metadata
 *                                endpoints included; detail names the class)
 *   E_REDIRECT_SCHEME_DOWNGRADE— https → http
 *   E_REDIRECT_LOOP            — target already visited
 *
 * Order matters: host classification runs BEFORE the downgrade check so a
 * redirect to `http://127.0.0.1:8080/` reports the IP violation, not the
 * port/scheme detail. Hostname targets are DNS-verified (async).
 */
export async function checkRedirect(chain, opts = {}) {
  const last = chain[chain.length - 1];
  if (!last || !last.location) {
    throwMalformed('redirect response without a Location header');
  }
  let prev;
  try {
    prev = new URL(last.url);
  } catch {
    throwMalformed('redirect chain has an unparsable source URL');
  }
  let target;
  try {
    target = new URL(String(last.location), prev);
  } catch {
    throwMalformed(`redirect Location '${last.location}' is unparsable`);
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new ShieldRefusedError(
      'E_REDIRECT_BAD_SCHEME',
      `redirect target scheme '${target.protocol}' is not allowed`,
    );
  }

  // Host classification: IP literals directly; hostnames via verified DNS.
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  let classification;
  if (isIpLiteral(host)) {
    const cls = classifyIp(host);
    if (!cls.public) {
      throw new ShieldRefusedError('E_REDIRECT_TO_PRIVATE_IP', `redirect target ${cls.detail}`);
    }
    classification = cls;
  } else {
    if (METADATA_HOSTS.has(host)) {
      throw new ShieldRefusedError(
        'E_REDIRECT_TO_PRIVATE_IP',
        `redirect target '${host}' is a cloud metadata endpoint hostname`,
      );
    }
    try {
      const resolution = await resolveAndVerify(host, { resolver: opts.resolver });
      classification = { public: true, type: 'public', detail: 'verified public resolution' };
    } catch (err) {
      if (err instanceof ShieldRefusedError) {
        // DNS-level refusal on a redirect hop → stable redirect code,
        // original detail preserved for the audit trail.
        throw new ShieldRefusedError(
          'E_REDIRECT_TO_PRIVATE_IP',
          `redirect target refused by DNS guard (${err.detail})`,
        );
      }
      throw err;
    }
  }

  if (prev.protocol === 'https:' && target.protocol === 'http:') {
    throw new ShieldRefusedError(
      'E_REDIRECT_SCHEME_DOWNGRADE',
      `redirect would downgrade https to plaintext http (${target.host})`,
    );
  }

  const seen = new Set(chain.map((h) => { try { return loopKey(new URL(h.url)); } catch { return h.url; } }));
  if (seen.has(loopKey(target))) {
    throw new ShieldRefusedError('E_REDIRECT_LOOP', `redirect loop at ${target.host}`);
  }

  return { allowed: true, target, classification };
}

/* ────────────────────────── default transport ─────────────────────────── */

/**
 * Real socket engine: dials the VERIFIED IP via a custom lookup (no DNS
 * re-resolve — the same resolution the guard verified is reused), keeps the
 * original hostname for SNI + node's own checkServerIdentity, and captures
 * the peer certificate for the shield's explicit post-connect verification.
 * The lookup refuses any attempt to resolve a DIFFERENT host (tripwire).
 */
function nodeTransport({ url, hostname, ip, family, port, method, headers, signal }) {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    // Fresh, non-pooled connection per request. A pooled keep-alive socket
    // would (a) silently bypass THIS request's own verified-IP guarantee and
    // (b) make peer-certificate capture unreliable (cert state on reused
    // sockets is not dependable) — both unacceptable for a pinned shield.
    const agent = new lib.Agent({ keepAlive: false, maxSockets: 1 });
    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; try { agent.destroy(); } catch { /* noop */ } reject(err); } };
    const done = (res) => { if (!settled) { settled = true; resolve(res); } };

    let req;
    try {
      req = lib.request({
        host: hostname,                 // SNI + cert identity = original hostname
        servername: isHttps ? hostname : undefined,
        path: (url.pathname || '/') + (url.search || ''), // full path + query
        port: port || (isHttps ? 443 : 80),
        method: method || 'GET',
        headers: {
          // The pinned transport reads raw bytes (no decompression) —
          // declare identity explicitly so an upstream never sends a
          // compressed body this shield cannot verify/cap correctly.
          'accept-encoding': 'identity',
          ...(headers || {}),
        },
        agent,
        lookup: (h, _opts, cb) => {
          if (String(h).toLowerCase().replace(/\.+$/, '') !== hostname) {
            const err = new ShieldRefusedError(
              'E_PINNED_HOST_MISMATCH',
              `socket tried to resolve '${h}' instead of pinned '${hostname}'`,
            );
            return cb(err);
          }
          // net may call with {all:true} (happy-eyeballs) or a family number.
          const opts = (typeof _opts === 'object' && _opts) || {};
          if (opts.all) cb(null, [{ address: ip, family }]);
          else cb(null, ip, family);
        },
      }, (res) => {
        let cert = null;
        try {
          cert = isHttps && res.socket ? res.socket.getPeerCertificate(true) : null;
        } catch { cert = null; }
        if (!cert || !cert.valid_to) cert = null; // reused/odd socket → treat as absent
        // Free the dedicated agent once this response is done (consumed or
        // cancelled) — no lingering sockets.
        try { res.on('close', () => { try { agent.destroy(); } catch { /* noop */ } }); } catch { /* noop */ }
        // Normalize to the shield's upstream shape (IncomingMessage has
        // `statusCode`, the shield contract is `status`).
        done({ status: res.statusCode, headers: res.headers, body: res, cert });
      });
    } catch (err) {
      fail(err);
      return;
    }

    req.on('error', fail);
    if (signal) {
      if (signal.aborted) {
        const e = new Error('This operation was aborted');
        e.name = 'AbortError';
        fail(e);
        req.destroy(e);
      } else {
        signal.addEventListener('abort', () => {
          const e = new Error('This operation was aborted');
          e.name = 'AbortError';
          fail(e);
          req.destroy(e);
        }, { once: true });
      }
    }
    req.end();
  });
}

/* ──────────────────────────── pinnedFetch ─────────────────────────────── */

const cancelBody = async (up) => {
  try {
    const b = (up && up.body) || up; // wrapper shape or raw stream
    if (b && typeof b.cancel === 'function') await b.cancel();
    else if (b && typeof b.destroy === 'function') b.destroy();
  } catch { /* noop */ }
};

function headerGet(headers) {
  return (name) => {
    if (!headers) return null;
    if (typeof headers.get === 'function') return headers.get(name);
    const key = String(name).toLowerCase();
    const v = headers[key];
    return v === undefined ? null : String(v);
  };
}

/** Normalize a transport result to the shield's response shape. */
function toShieldResponse(up, urlObj) {
  const iterable = up.body && typeof up.body[Symbol.asyncIterator] === 'function'
    ? up.body
    : null;
  return {
    status: up.status,
    headers: { get: headerGet(up.headers) },
    body: {
      [Symbol.asyncIterator]: iterable
        ? () => iterable[Symbol.asyncIterator]()
        : async function* () { /* no body */ },
      cancel: async () => { await cancelBody(up); },
    },
    text: async () => {
      if (!iterable) return '';
      const chunks = [];
      for await (const c of iterable) chunks.push(c);
      return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
    },
    _upstream: urlObj.toString(),
  };
}

function abortError() {
  const e = new Error('This operation was aborted');
  e.name = 'AbortError';
  return e;
}

/**
 * Fetch a URL through the SSRF shield.
 *
 * @param {string} rawUrl
 * @param {object} [opts]
 *   resolver       injectable DNS (labeled doubles; default: node dns)
 *   transport      injectable socket engine (labeled doubles; default: node
 *                  http/https with pinned lookup + cert capture)
 *   label          honest label for the run, surfaced as meta.label
 *   maxRedirects   0 (default): refuse — 3xx returned to the caller;
 *                  >0: follow up to N hops, each via checkRedirect + full
 *                  re-resolution
 *   pins           { hostname: [sha256 fingerprint, ...] } — when set, the
 *                  certificate fingerprint must match
 *   timeoutMs      per-hop wall clock (default 15s; AbortError on breach)
 *   signal         external AbortSignal
 *   method, headers
 * @returns {{
 *   status: number, headers: {get}, body: {asyncIterator, cancel},
 *   text(): Promise<string>,
 *   meta: { url, hostname, verifiedIp, family, resolved, tls, redirectChain, label }
 * }}
 * @throws ShieldRefusedError (stable codes) on any shield refusal
 */
export async function pinnedFetch(rawUrl, opts = {}, _depth = 0, _prior = null, _chain = []) {
  const maxRedirects = Number.isInteger(opts.maxRedirects)
    ? opts.maxRedirects
    : DEFAULT_MAX_REDIRECTS;
  const timeoutMs = Number.isInteger(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const transport = opts.transport || nodeTransport;

  if (_depth > FOLLOW_MAX_REDIRECTS + 1) {
    throw new ShieldRefusedError('E_REDIRECT_LOOP', 'too many redirect hops');
  }

  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throwMalformed(`'${String(rawUrl).slice(0, 200)}' is not a parsable URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ShieldRefusedError('E_INSECURE_SCHEME', `scheme '${url.protocol}' is not allowed by the shield`);
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');

  // IP-literal URLs: classify directly (no DNS). Hostnames: ONE verified round.
  let resolution;
  if (isIpLiteral(hostname)) {
    const cls = classifyIp(hostname);
    if (!cls.public) {
      const code = ({
        metadata: 'E_METADATA_ENDPOINT_REFUSED',
        loopback: 'E_LOOPBACK_REFUSED',
        'link-local': 'E_LINK_LOCAL_REFUSED',
        multicast: 'E_MULTICAST_REFUSED',
        private: 'E_PRIVATE_IP_REFUSED',
        reserved: 'E_NON_PUBLIC_IP_REFUSED',
      })[cls.type] || 'E_NON_PUBLIC_IP_REFUSED';
      throw new ShieldRefusedError(code, `${url.host} is ${cls.detail}`);
    }
    resolution = {
      hostname, addresses: [{ ip: hostname, family: hostname.includes(':') ? 6 : 4 }],
      v4: hostname.includes(':') ? [] : [hostname],
      v6: hostname.includes(':') ? [hostname] : [],
      classified: [{ ip: hostname, ...cls }], verifiedAt: new Date().toISOString(),
    };
  } else {
    const prior = _prior && _prior.hostname === hostname ? _prior : null;
    resolution = await resolveAndVerify(hostname, { resolver: opts.resolver, prior });
  }
  const pick = resolution.addresses.find((a) => a.family === 4) || resolution.addresses[0];

  // One wall-clock budget per hop, chained to any external signal.
  const ctrl = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) throw abortError();
    opts.signal.addEventListener('abort', () => ctrl.abort(opts.signal.reason), { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(abortError()), timeoutMs);

  let up;
  try {
    up = await transport({
      url, hostname, ip: pick.ip, family: pick.family,
      port: url.port || undefined,
      method: opts.method || 'GET',
      headers: opts.headers || {},
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
  clearTimeout(timer);

  // Post-connect TLS verification against the ORIGINAL hostname.
  let tlsReport = null;
  if (url.protocol === 'https:') {
    tlsReport = verifyPinnedCert({ hostname, cert: up.cert || null, pins: opts.pins });
    if (!tlsReport.ok) {
      await cancelBody(up);
      throw new ShieldRefusedError(tlsReport.code, tlsReport.detail);
    }
  }

  const response = toShieldResponse(up, url);

  // Redirect handling.
  if (response.status >= 300 && response.status < 400) {
    if (_depth >= maxRedirects) {
      // Refuse-by-default: surface the 3xx to the caller (broker semantics).
      response.meta = makeMeta(url, resolution, pick, tlsReport, _chain, opts);
      return response;
    }
    const location = response.headers.get('location');
    const chain = [..._chain, { url: url.toString(), status: response.status, location }];
    let decision;
    try {
      decision = await checkRedirect(chain, { resolver: opts.resolver });
    } catch (err) {
      await cancelBody(up); // never leak the hop-1 socket on refusal
      throw err;
    }
    await cancelBody(up);
    return pinnedFetch(decision.target.toString(), opts, _depth + 1, resolution, chain);
  }

  response.meta = makeMeta(url, resolution, pick, tlsReport, _chain, opts);
  return response;
}

function makeMeta(url, resolution, pick, tlsReport, chain, opts) {
  return {
    url: url.toString(),
    hostname: resolution.hostname,
    verifiedIp: pick.ip,
    family: pick.family,
    resolved: resolution.addresses.map((a) => `${a.ip} (v${a.family})`),
    classified: resolution.classified.map((c) => ({
      ip: c.ip, family: c.family, type: c.type, public: c.public === true, detail: c.detail,
    })),
    tls: tlsReport
      ? (tlsReport.ok
        ? { ok: true, ...tlsReport.report, checks: tlsReport.checks }
        : tlsReport)
      : null,
    redirectChain: chain.map(({ url: u, status }) => ({ url: u, status })),
    label: opts.label || null,
  };
}

/* ─────────────────── fetch()-compatible broker adapter ────────────────── */

/**
 * Build a fetch()-compatible implementation backed by pinnedFetch — the
 * trust pipeline broker's DEFAULT transport (Scope B wiring). Accepts
 * fetch-style options: { method, headers, redirect, signal }.
 *
 * redirect: 'manual' (default) → any 3xx surfaces untouched (broker refuses)
 * redirect: 'follow'            → up to FOLLOW_MAX_REDIRECTS shielded hops
 */
export function createPinnedFetchImpl(shieldOpts = {}) {
  return async function pinnedFetchImpl(url, fetchOpts = {}) {
    const follow = fetchOpts.redirect === 'follow';
    return pinnedFetch(url, {
      ...shieldOpts,
      method: fetchOpts.method || 'GET',
      headers: fetchOpts.headers,
      signal: fetchOpts.signal,
      maxRedirects: follow ? FOLLOW_MAX_REDIRECTS : 0,
    });
  };
}
